/** The action ledger, refs (provenance) and draft-save snapshots. */
import { describe, expect, it } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import { ACTION, ADMIN, CONVERSATION, FakeDb, HASH, NOW, OTHER_ADMIN, PROPOSAL, eqOf, hasStep, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);
const REF_A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REF_B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, actions: store.actions, refs: store.refs, snapshots: store.snapshots };
}

const action = (extra: Record<string, unknown> = {}) => ({ id: ACTION, conversation_id: CONVERSATION, admin_id: ADMIN, status: 'executing', ...extra });
const newAction = { conversationId: CONVERSATION, toolUseId: 'toolu_1', toolName: 'format_save_draft', class: 'D', args: { id: REF_A }, argsHash: HASH } as const;

describe('actions', () => {
  it('inserts the ledger row first, in executing, for the conversation\'s admin', async () => {
    const { db, actions } = setup();
    ownsConversation(db);
    db.on('admin_agent_actions', 'insert', { data: action() });
    const result = await actions.insertAction(admin, { ...newAction, method: 'PUT', path: '/api/formats/x/draft' });
    expect(result).toEqual({ inserted: true, action: action() });
    expect(db.to('admin_agent_actions', 'insert')[0].payload).toEqual({
      conversation_id: CONVERSATION,
      admin_id: ADMIN,
      admin_name: 'Test Admin',
      tool_use_id: 'toolu_1',
      tool_name: 'format_save_draft',
      class: 'D',
      proposal_id: null,
      step_key: null,
      method: 'PUT',
      path: '/api/formats/x/draft',
      args: { id: REF_A },
      args_hash: HASH,
    });
  });

  it.each(['admin_agent_actions_tool_use_key', 'admin_agent_actions_step_key'])('reports inserted:false on a taken dispatch key (%s)', async (constraint) => {
    const { db, actions } = setup();
    ownsConversation(db);
    db.on('admin_agent_actions', 'insert', { error: { code: '23505', message: `duplicate key value violates unique constraint "${constraint}"` } });
    expect(await actions.insertAction(admin, newAction)).toEqual({ inserted: false });
  });

  it('maps another insert failure to a db error (no ledger, no write)', async () => {
    const { db, actions } = setup();
    ownsConversation(db);
    db.on('admin_agent_actions', 'insert', { error: { code: '23514', message: 'violates check constraint "admin_agent_actions_args_size"' } });
    await expect(actions.insertAction(admin, newAction)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', dbCode: '23514' });
  });

  it('needs the proposal and the step key together, and a proposal of this admin in this conversation', async () => {
    const { db, actions } = setup();
    ownsConversation(db);
    await expect(actions.insertAction(admin, { ...newAction, proposalId: PROPOSAL })).rejects.toMatchObject({ reason: 'proposal_and_step_key_go_together' });
    await expect(actions.insertAction(admin, { ...newAction, proposalId: PROPOSAL, stepKey: 's1' })).rejects.toMatchObject({ code: 'proposal_not_found' });
    expect(db.to('admin_agent_actions', 'insert')).toHaveLength(0);

    const ok = setup();
    ownsConversation(ok.db);
    ok.db.on('admin_agent_proposals', 'select', { data: { id: PROPOSAL } });
    ok.db.on('admin_agent_actions', 'insert', { data: action({ proposal_id: PROPOSAL, step_key: 's1' }) });
    expect((await ok.actions.insertAction(admin, { ...newAction, toolUseId: null, proposalId: PROPOSAL, stepKey: 's1' })).inserted).toBe(true);
    const check = ok.db.to('admin_agent_proposals')[0];
    expect(eqOf(check, 'admin_id')).toBe(ADMIN);
    expect(eqOf(check, 'conversation_id')).toBe(CONVERSATION);
  });

  it('refuses a private key in the args and another admin\'s conversation before the insert', async () => {
    const { db, actions } = setup();
    ownsConversation(db);
    await expect(actions.insertAction(admin, { ...newAction, args: { player: { discord_id: '1' } } })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    await expect(actions.insertAction(other, newAction)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.to('admin_agent_actions', 'insert')).toHaveLength(0);
  });

  it('completes a row with only the fields given, scoped to the admin', async () => {
    const { db, actions } = setup();
    db.on('admin_agent_actions', 'update', { data: action({ status: 'ok' }) });
    await actions.completeAction(admin, ACTION, { status: 'ok', httpStatus: 201, entityType: 'season', entityId: REF_A, afterFingerprint: 'fp', result: { id: REF_A } });
    expect(db.calls[0].payload).toEqual({
      status: 'ok',
      http_status: 201,
      result: { id: REF_A },
      after_fingerprint: 'fp',
      entity_type: 'season',
      entity_id: REF_A,
    });
    expect(eqOf(db.calls[0], 'id')).toBe(ACTION);
    expect(eqOf(db.calls[0], 'admin_id')).toBe(ADMIN);
  });

  it('fails a completion for a row that is not the admin\'s and refuses private keys in the outcome', async () => {
    const { db, actions } = setup();
    await expect(actions.completeAction(other, ACTION, { status: 'ok' })).rejects.toMatchObject({ reason: 'action_not_found' });
    await expect(actions.completeAction(admin, ACTION, { result: { password: 'x' } })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    await expect(actions.completeAction(admin, ACTION, { after: { webhook_url: 'x' } })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    expect(db.calls.filter((c) => c.op === 'update' && eqOf(c, 'admin_id') === ADMIN)).toHaveLength(0);
  });

  it('reads by tool use, by id and by proposal behind the admin check', async () => {
    const { db, actions } = setup();
    ownsConversation(db);
    db.on('admin_agent_actions', 'select', { data: action() });
    expect((await actions.getActionByToolUse(admin, CONVERSATION, 'toolu_1'))?.id).toBe(ACTION);
    expect(await actions.getAction(other, 'nope')).toBeNull();
    await actions.getAction(other, ACTION);
    expect(eqOf(db.to('admin_agent_actions')[1], 'admin_id')).toBe(OTHER_ADMIN);
    await actions.listActions(admin, CONVERSATION, 9999);
    const list = db.to('admin_agent_actions').at(-1)!;
    expect(hasStep(list, 'limit', 500)).toBe(true);
    expect(eqOf(list, 'admin_id')).toBe(ADMIN);
    await actions.listProposalActions(admin, PROPOSAL);
    expect(eqOf(db.to('admin_agent_actions').at(-1)!, 'proposal_id')).toBe(PROPOSAL);
    expect(await actions.listProposalActions(admin, 'nope')).toEqual([]);
  });
});

describe('refs (provenance)', () => {
  it('records new refs insert-only (do nothing on conflict), trimming labels and skipping bad ids and repeats', async () => {
    const { db, refs } = setup();
    ownsConversation(db);
    const count = await refs.recordRefs(admin, CONVERSATION, [
      { kind: 'season', id: REF_A.toUpperCase(), label: 'L'.repeat(400), source: 'tool_result' },
      { kind: 'season', id: REF_A, source: 'tool_result' },
      { kind: 'player', id: REF_B, source: 'user_message' },
      { kind: 'player', id: 'not-a-uuid', source: 'user_message' },
      { kind: '', id: REF_B, source: 'user_message' },
    ]);
    expect(count).toBe(2);
    const call = db.to('admin_agent_refs', 'upsert')[0];
    expect(call.payload).toEqual([
      { conversation_id: CONVERSATION, ref_kind: 'season', ref_id: REF_A, label: 'L'.repeat(300), source: 'tool_result' },
      { conversation_id: CONVERSATION, ref_kind: 'player', ref_id: REF_B, label: null, source: 'user_message' },
    ]);
    expect(call.steps.find((s) => s[0] === 'upsert')?.[2]).toEqual({ onConflict: 'conversation_id,ref_kind,ref_id', ignoreDuplicates: true });
  });

  it('writes nothing for an empty batch and refuses another admin\'s conversation', async () => {
    const { db, refs } = setup();
    ownsConversation(db);
    expect(await refs.recordRefs(admin, CONVERSATION, [])).toBe(0);
    await expect(refs.recordRefs(other, CONVERSATION, [{ kind: 'season', id: REF_A, source: 'tool_result' }])).rejects.toMatchObject({
      code: 'conversation_not_found',
    });
    expect(db.to('admin_agent_refs')).toHaveLength(0);
  });

  it('answers which of the given ids the conversation has seen, in chunks', async () => {
    const { db, refs } = setup();
    ownsConversation(db);
    db.on('admin_agent_refs', 'select', (call) => {
      const wanted = (call.steps.find((s) => s[0] === 'in')?.[2] ?? []) as string[];
      return { data: wanted.includes(REF_A) ? [{ ref_id: REF_A }] : [] };
    });
    const many = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const known = await refs.knownRefIds(admin, CONVERSATION, [REF_A.toUpperCase(), REF_B, 'junk', ...many]);
    expect([...known]).toEqual([REF_A]);
    expect(db.to('admin_agent_refs')).toHaveLength(2);
    for (const call of db.to('admin_agent_refs')) expect(eqOf(call, 'conversation_id')).toBe(CONVERSATION);
  });

  it('lists refs, optionally of one kind', async () => {
    const { db, refs } = setup();
    ownsConversation(db);
    await refs.listRefs(admin, CONVERSATION, 'season');
    expect(eqOf(db.to('admin_agent_refs')[0], 'ref_kind')).toBe('season');
  });
});

describe('snapshots', () => {
  const doc = { rules: [] };

  it('stores the previous draft for a ledger row of the admin', async () => {
    const { db, snapshots } = setup();
    db.on('admin_agent_actions', 'select', { data: { id: ACTION } });
    db.on('admin_agent_snapshots', 'insert', { data: { id: 's', action_id: ACTION } });
    await snapshots.insertSnapshot(admin, { actionId: ACTION, document: doc, docHash: HASH });
    expect(db.to('admin_agent_snapshots', 'insert')[0].payload).toEqual({ action_id: ACTION, document: doc, doc_hash: HASH });
    expect(eqOf(db.to('admin_agent_actions')[0], 'admin_id')).toBe(ADMIN);
  });

  it('returns the first snapshot of a row when a second arrives', async () => {
    const { db, snapshots } = setup();
    db.on('admin_agent_actions', 'select', { data: { id: ACTION } });
    db.on('admin_agent_snapshots', 'insert', { error: { code: '23505', message: 'duplicate key value violates unique constraint "admin_agent_snapshots_action_id_key"' } });
    db.on('admin_agent_snapshots', 'select', { data: { id: 'first', action_id: ACTION } });
    expect((await snapshots.insertSnapshot(admin, { actionId: ACTION, document: doc, docHash: HASH })).id).toBe('first');
  });

  it('refuses a ledger row of another admin and a document with a private key', async () => {
    const { db, snapshots } = setup();
    await expect(snapshots.insertSnapshot(other, { actionId: ACTION, document: doc, docHash: HASH })).rejects.toMatchObject({ reason: 'action_not_found' });
    db.on('admin_agent_actions', 'select', { data: { id: ACTION } });
    await expect(snapshots.insertSnapshot(admin, { actionId: ACTION, document: { webhook_url: 'x' }, docHash: HASH })).rejects.toMatchObject({
      reason: 'payload_forbidden',
    });
    expect(db.to('admin_agent_snapshots')).toHaveLength(0);
  });

  it('reads only an unexpired snapshot, and only for the admin\'s own ledger row', async () => {
    const { db, snapshots } = setup();
    expect(await snapshots.getSnapshot(other, ACTION)).toBeNull();
    expect(db.to('admin_agent_snapshots')).toHaveLength(0);

    db.on('admin_agent_actions', 'select', { data: { id: ACTION } });
    db.on('admin_agent_snapshots', 'select', { data: { id: 's' } });
    expect(await snapshots.getSnapshot(admin, ACTION)).toEqual({ id: 's' });
    expect(hasStep(db.to('admin_agent_snapshots')[0], 'gt', 'expires_at', NOW.toISOString())).toBe(true);
  });

  it('lets a later undo find a draft write by conversation and definition: the ledger row names the entity and the recipe, the snapshot hangs off its id', async () => {
    const { db, actions, snapshots } = setup();
    ownsConversation(db);
    const DEFINITION = '33333333-cccc-4ccc-8ccc-cccccccccccc';
    const write = action({
      tool_name: 'ruleset_patch_draft',
      class: 'D',
      status: 'ok',
      entity_type: 'ruleset',
      entity_id: DEFINITION,
      before: { ruleset_id: DEFINITION, draft_rev: 3, doc_hash: HASH },
      after: { ruleset_id: DEFINITION, draft_rev: 4, doc_hash: HASH },
      undo: { kind: 'restore_draft_snapshot', ruleset_id: DEFINITION, draft_rev_after: 4 },
    });
    const decoy = action({ id: '99999999-9999-4999-8999-999999999999', tool_name: 'ruleset_create_draft', entity_type: 'ruleset', entity_id: REF_A });
    db.on('admin_agent_actions', 'select', (call) => (hasStep(call, 'limit', 200) ? { data: [decoy, write] } : { data: { id: ACTION } }));
    db.on('admin_agent_snapshots', 'select', { data: { id: 's', action_id: ACTION, document: { rules: ['a'] }, doc_hash: HASH } });

    // By conversation: the admin's ledger, then the row for this definition.
    const ledger = await actions.listActions(admin, CONVERSATION);
    const found = ledger.find((row) => row.entity_type === 'ruleset' && row.entity_id === DEFINITION && row.tool_name === 'ruleset_patch_draft');
    expect(found?.undo).toEqual({ kind: 'restore_draft_snapshot', ruleset_id: DEFINITION, draft_rev_after: 4 });
    // By ledger row: the previous document, with the hash the recipe is checked against.
    const snapshot = await snapshots.getSnapshot(admin, found!.id);
    expect(snapshot).toEqual({ id: 's', action_id: ACTION, document: { rules: ['a'] }, doc_hash: HASH });
    expect(eqOf(db.to('admin_agent_snapshots')[0], 'action_id')).toBe(ACTION);
    // Both reads are scoped to the admin's own ledger rows.
    expect(eqOf(db.to('admin_agent_actions').find((call) => hasStep(call, 'limit', 200))!, 'admin_id')).toBe(ADMIN);
    expect(eqOf(db.to('admin_agent_actions').at(-1)!, 'admin_id')).toBe(ADMIN);
  });
});
