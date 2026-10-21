import { describe, it, expect } from 'vitest';
import { soloPlayerDefaults, soloPlaceholderOf } from '../solo-defaults';

describe('soloPlaceholderOf', () => {
  it('recognises the stored placeholder names only', () => {
    expect(soloPlaceholderOf('Me')).toBe('me');
    expect(soloPlaceholderOf('Opponent')).toBe('opponent');
    expect(soloPlaceholderOf('Alice')).toBeNull();
    expect(soloPlaceholderOf('opponent')).toBeNull();
  });
});

describe('soloPlayerDefaults', () => {
  it('returns player1 with owner_id when player1_id is null', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: null,
      player1_name: null,
      player1_avatar_url: null,
      player2_id: null,
      player2_name: null,
      player2_avatar_url: null,
    });

    expect(result.player1.id).toBe('owner-1');
    expect(result.player1.name).toBe('Me');
    expect(result.player1.avatar_url).toBeNull();
  });

  it('returns player2 with solo-opponent when player2_id is null', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: null,
      player1_name: null,
      player1_avatar_url: null,
      player2_id: null,
      player2_name: null,
      player2_avatar_url: null,
    });

    expect(result.player2.id).toBe('solo-opponent');
    expect(result.player2.name).toBe('Opponent');
    expect(result.player2.avatar_url).toBeNull();
  });

  it('uses provided player1 values when set', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: 'custom-p1',
      player1_name: 'Alice',
      player1_avatar_url: 'https://example.com/alice.png',
      player2_id: null,
      player2_name: null,
      player2_avatar_url: null,
    });

    expect(result.player1.id).toBe('custom-p1');
    expect(result.player1.name).toBe('Alice');
    expect(result.player1.avatar_url).toBe('https://example.com/alice.png');
  });

  it('uses provided player2 values when set', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: null,
      player1_name: null,
      player1_avatar_url: null,
      player2_id: 'custom-p2',
      player2_name: 'Bob',
      player2_avatar_url: 'https://example.com/bob.png',
    });

    expect(result.player2.id).toBe('custom-p2');
    expect(result.player2.name).toBe('Bob');
    expect(result.player2.avatar_url).toBe('https://example.com/bob.png');
  });

  it('uses owner_id for player1 when player1_id is empty string (falsy)', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: '',
      player1_name: '',
      player1_avatar_url: null,
      player2_id: '',
      player2_name: '',
      player2_avatar_url: null,
    });

    // Empty string is falsy so falls through to owner_id / defaults
    expect(result.player1.id).toBe('owner-1');
    expect(result.player1.name).toBe('Me');
    expect(result.player2.id).toBe('solo-opponent');
    expect(result.player2.name).toBe('Opponent');
  });

  it('handles all fields populated', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: 'p1-id',
      player1_name: 'Streamer',
      player1_avatar_url: 'https://example.com/streamer.png',
      player2_id: 'p2-id',
      player2_name: 'Challenger',
      player2_avatar_url: 'https://example.com/challenger.png',
    });

    expect(result.player1).toEqual({
      id: 'p1-id',
      name: 'Streamer',
      avatar_url: 'https://example.com/streamer.png',
    });
    expect(result.player2).toEqual({
      id: 'p2-id',
      name: 'Challenger',
      avatar_url: 'https://example.com/challenger.png',
    });
  });

  it('preserves null avatar_url when not provided', () => {
    const result = soloPlayerDefaults({
      owner_id: 'owner-1',
      player1_id: 'p1',
      player1_name: 'Alice',
      player1_avatar_url: null,
      player2_id: 'p2',
      player2_name: 'Bob',
      player2_avatar_url: null,
    });

    expect(result.player1.avatar_url).toBeNull();
    expect(result.player2.avatar_url).toBeNull();
  });
});
