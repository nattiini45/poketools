export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      achievement_definitions: {
        Row: {
          category: string
          created_at: string
          criteria: Json
          description: string
          hidden: boolean
          icon: string | null
          id: string
          key: string
          name: string
          repeatable: boolean
          tier: string
        }
        Insert: {
          category: string
          created_at?: string
          criteria: Json
          description: string
          hidden?: boolean
          icon?: string | null
          id?: string
          key: string
          name: string
          repeatable?: boolean
          tier: string
        }
        Update: {
          category?: string
          created_at?: string
          criteria?: Json
          description?: string
          hidden?: boolean
          icon?: string | null
          id?: string
          key?: string
          name?: string
          repeatable?: boolean
          tier?: string
        }
        Relationships: []
      }
      admin_export_limits: {
        Row: {
          player_id: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          player_id: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Update: {
          player_id?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_export_limits_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          last_message_at: string
          messages: Json
          persona: string
          player_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string
          messages: Json
          persona: string
          player_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string
          messages?: Json
          persona?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_suggestions: {
        Row: {
          context_format: string
          conversation_id: string
          id: string
          match_id: string | null
          player_id: string
          proposed_team: Json | null
          reasoning: string | null
          suggested_at: string
          topic_tags: string[] | null
          user_accepted_at: string | null
          user_rejected_at: string | null
        }
        Insert: {
          context_format: string
          conversation_id: string
          id?: string
          match_id?: string | null
          player_id: string
          proposed_team?: Json | null
          reasoning?: string | null
          suggested_at?: string
          topic_tags?: string[] | null
          user_accepted_at?: string | null
          user_rejected_at?: string | null
        }
        Update: {
          context_format?: string
          conversation_id?: string
          id?: string
          match_id?: string | null
          player_id?: string
          proposed_team?: Json | null
          reasoning?: string | null
          suggested_at?: string
          topic_tags?: string[] | null
          user_accepted_at?: string | null
          user_rejected_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_suggestions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_suggestions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_suggestions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      aggregate_jobs: {
        Row: {
          attempts: number
          created_at: string
          game_id: string
          id: string
          last_error: string | null
          max_attempts: number
          operation: string
          processed_at: string | null
          season_id: string | null
          status: string
          tournament_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          game_id: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          operation?: string
          processed_at?: string | null
          season_id?: string | null
          status?: string
          tournament_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          game_id?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          operation?: string
          processed_at?: string | null
          season_id?: string | null
          status?: string
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aggregate_jobs_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      aggregates: {
        Row: {
          id: string
          last_updated: string
          move_counts: Json
          pokemon_name: string
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances: number
          total_brought: number
          total_games: number
          total_koed: number
          total_kos_dealt: number
          total_led: number
          total_wins: number
        }
        Insert: {
          id?: string
          last_updated?: string
          move_counts?: Json
          pokemon_name: string
          scope_id?: string | null
          scope_type: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances?: number
          total_brought?: number
          total_games?: number
          total_koed?: number
          total_kos_dealt?: number
          total_led?: number
          total_wins?: number
        }
        Update: {
          id?: string
          last_updated?: string
          move_counts?: Json
          pokemon_name?: string
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances?: number
          total_brought?: number
          total_games?: number
          total_koed?: number
          total_kos_dealt?: number
          total_led?: number
          total_wins?: number
        }
        Relationships: []
      }
      ai_avatar_gallery: {
        Row: {
          choices: Json
          created_at: string
          id: string
          image_url: string
          player_id: string
          style: string
        }
        Insert: {
          choices?: Json
          created_at?: string
          id?: string
          image_url: string
          player_id: string
          style?: string
        }
        Update: {
          choices?: Json
          created_at?: string
          id?: string
          image_url?: string
          player_id?: string
          style?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_avatar_gallery_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          player_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          player_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          changes: Json | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          resource_id: string | null
          resource_name: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_name?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_name?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      avatar_generations: {
        Row: {
          created_at: string
          id: string
          player_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avatar_generations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_stats: {
        Row: {
          created_at: string
          game_id: string
          id: string
          kos_dealt: number
          match_won: boolean
          moves_used: Json
          player_id: string
          pokemon_name: string
          turns_active: number
          was_brought: boolean
          was_koed: boolean
          was_lead: boolean
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          kos_dealt?: number
          match_won?: boolean
          moves_used?: Json
          player_id: string
          pokemon_name: string
          turns_active?: number
          was_brought?: boolean
          was_koed?: boolean
          was_lead?: boolean
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          kos_dealt?: number
          match_won?: boolean
          moves_used?: Json
          player_id?: string
          pokemon_name?: string
          turns_active?: number
          was_brought?: boolean
          was_koed?: boolean
          was_lead?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "battle_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_moments: {
        Row: {
          created_by: string
          description: string | null
          game_id: string | null
          id: string
          match_id: string
          moment_type: string
          pokemon_name: string | null
          timestamp: string
          turn_number: number | null
        }
        Insert: {
          created_by: string
          description?: string | null
          game_id?: string | null
          id?: string
          match_id: string
          moment_type: string
          pokemon_name?: string | null
          timestamp?: string
          turn_number?: number | null
        }
        Update: {
          created_by?: string
          description?: string | null
          game_id?: string | null
          id?: string
          match_id?: string
          moment_type?: string
          pokemon_name?: string | null
          timestamp?: string
          turn_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_moments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_moments_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_moments_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_presets: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          owner_id: string
          preset_type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name: string
          owner_id: string
          preset_type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          preset_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_presets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      cast_sessions: {
        Row: {
          caster_notes: Json | null
          created_at: string
          format: string
          generation: number
          id: string
          match_id: string | null
          mode: string
          name: string
          overlay_config: Json
          owner_id: string
          player1_avatar_url: string | null
          player1_id: string | null
          player1_name: string | null
          player1_team: Json
          player2_avatar_url: string | null
          player2_id: string | null
          player2_name: string | null
          player2_team: Json
          realtime_key: string
          season_id: string | null
          status: string
          tournament_id: string | null
          tracker_state: Json | null
          updated_at: string
        }
        Insert: {
          caster_notes?: Json | null
          created_at?: string
          format?: string
          generation?: number
          id?: string
          match_id?: string | null
          mode?: string
          name?: string
          overlay_config?: Json
          owner_id: string
          player1_avatar_url?: string | null
          player1_id?: string | null
          player1_name?: string | null
          player1_team?: Json
          player2_avatar_url?: string | null
          player2_id?: string | null
          player2_name?: string | null
          player2_team?: Json
          realtime_key?: string
          season_id?: string | null
          status?: string
          tournament_id?: string | null
          tracker_state?: Json | null
          updated_at?: string
        }
        Update: {
          caster_notes?: Json | null
          created_at?: string
          format?: string
          generation?: number
          id?: string
          match_id?: string | null
          mode?: string
          name?: string
          overlay_config?: Json
          owner_id?: string
          player1_avatar_url?: string | null
          player1_id?: string | null
          player1_name?: string | null
          player1_team?: Json
          player2_avatar_url?: string | null
          player2_id?: string | null
          player2_name?: string | null
          player2_team?: Json
          realtime_key?: string
          season_id?: string | null
          status?: string
          tournament_id?: string | null
          tracker_state?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_sessions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_sessions_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_sessions_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_sessions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_sessions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_webhooks: {
        Row: {
          created_at: string
          enabled: boolean
          event_filter: string[]
          format_options: Json
          id: string
          label: string
          scope_id: string | null
          scope_type: string
          updated_at: string
          webhook_url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_filter?: string[]
          format_options?: Json
          id?: string
          label?: string
          scope_id?: string | null
          scope_type: string
          updated_at?: string
          webhook_url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_filter?: string[]
          format_options?: Json
          id?: string
          label?: string
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
          webhook_url?: string
        }
        Relationships: []
      }
      draft_action_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          after: Json | null
          before: Json | null
          client_request_id: string | null
          draft_pool_id: string | null
          id: number
          is_public: boolean
          line_id: string | null
          occurred_at: string
          pick_id: string | null
          player_id: string | null
          reason: string | null
          season_id: string
          slot_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          after?: Json | null
          before?: Json | null
          client_request_id?: string | null
          draft_pool_id?: string | null
          id?: never
          is_public?: boolean
          line_id?: string | null
          occurred_at?: string
          pick_id?: string | null
          player_id?: string | null
          reason?: string | null
          season_id: string
          slot_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          after?: Json | null
          before?: Json | null
          client_request_id?: string | null
          draft_pool_id?: string | null
          id?: never
          is_public?: boolean
          line_id?: string | null
          occurred_at?: string
          pick_id?: string | null
          player_id?: string | null
          reason?: string | null
          season_id?: string
          slot_id?: string | null
        }
        Relationships: []
      }
      draft_line_favorites: {
        Row: {
          created_at: string
          line_id: string
          player_id: string
        }
        Insert: {
          created_at?: string
          line_id: string
          player_id: string
        }
        Update: {
          created_at?: string
          line_id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_line_favorites_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_line_restrictions: {
        Row: {
          created_at: string
          created_by: string | null
          draft_pool_id: string
          line_id: string
          player_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          draft_pool_id: string
          line_id: string
          player_id: string
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          draft_pool_id?: string
          line_id?: string
          player_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_line_restrictions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_line_restrictions_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_line_restrictions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_participants: {
        Row: {
          budget_start: number
          created_at: string
          done_at: string | null
          draft_pool_id: string
          ext_plus120_used_at: string | null
          ext_plus60_used_at: string | null
          penalty_stage: number
          player_id: string
          seat: number
          slots_total: number
          standing_rank: number | null
          timeout_count: number
        }
        Insert: {
          budget_start?: number
          created_at?: string
          done_at?: string | null
          draft_pool_id: string
          ext_plus120_used_at?: string | null
          ext_plus60_used_at?: string | null
          penalty_stage?: number
          player_id: string
          seat: number
          slots_total?: number
          standing_rank?: number | null
          timeout_count?: number
        }
        Update: {
          budget_start?: number
          created_at?: string
          done_at?: string | null
          draft_pool_id?: string
          ext_plus120_used_at?: string | null
          ext_plus60_used_at?: string | null
          penalty_stage?: number
          player_id?: string
          seat?: number
          slots_total?: number
          standing_rank?: number | null
          timeout_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_participants_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_participants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          client_request_id: string | null
          draft_pool_id: string
          id: string
          line_entry_id: string | null
          line_id: string | null
          made_by: string | null
          made_by_role: string | null
          override_reason: string | null
          pick_number: number
          player_id: string
          points_spent: number | null
          pokemon_name: string
          redraft_slot_id: string | null
          round: number
          slot_id: string | null
          timestamp: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          client_request_id?: string | null
          draft_pool_id: string
          id?: string
          line_entry_id?: string | null
          line_id?: string | null
          made_by?: string | null
          made_by_role?: string | null
          override_reason?: string | null
          pick_number: number
          player_id: string
          points_spent?: number | null
          pokemon_name: string
          redraft_slot_id?: string | null
          round: number
          slot_id?: string | null
          timestamp?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          client_request_id?: string | null
          draft_pool_id?: string
          id?: string
          line_entry_id?: string | null
          line_id?: string | null
          made_by?: string | null
          made_by_role?: string | null
          override_reason?: string | null
          pick_number?: number
          player_id?: string
          points_spent?: number | null
          pokemon_name?: string
          redraft_slot_id?: string | null
          round?: number
          slot_id?: string | null
          timestamp?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_line_entry_id_fkey"
            columns: ["line_entry_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_made_by_fkey"
            columns: ["made_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_redraft_slot_fkey"
            columns: ["redraft_slot_id"]
            isOneToOne: false
            referencedRelation: "redraft_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "draft_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_pool_entries: {
        Row: {
          created_at: string
          id: string
          point_cost: number | null
          pokemon_name: string
          power_tier: string | null
          season_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          point_cost?: number | null
          pokemon_name: string
          power_tier?: string | null
          season_id: string
        }
        Update: {
          created_at?: string
          id?: string
          point_cost?: number | null
          pokemon_name?: string
          power_tier?: string | null
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_pool_entries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_pool_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entries: Json
          id: string
          name: string
          pool_mode: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entries?: Json
          id?: string
          name: string
          pool_mode?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entries?: Json
          id?: string
          name?: string
          pool_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_pool_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_pools: {
        Row: {
          created_at: string
          created_by: string | null
          default_point_cost: number | null
          draft_type: Database["public"]["Enums"]["draft_type"]
          ended_at: string | null
          engine: string
          extension_seconds: number[]
          extensions_enabled: boolean
          id: string
          kind: string
          list_version_id: string | null
          makeup_seconds: number | null
          mode: string
          parent_pool_id: string | null
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          phase: string
          pick_order: string
          pick_seconds: number | null
          point_budget: number | null
          pool_mode: string
          publish_notified_at: string | null
          publish_refused_at: string | null
          publish_refused_version: number | null
          quiet_end_hour: number | null
          quiet_start_hour: number | null
          quiet_timezone: string | null
          redraft_lock_no_redraft_lines: boolean
          redraft_max_lines: number | null
          roster_size: number | null
          season_group_id: string | null
          season_id: string
          slow_ladder_seconds: number[]
          started_at: string | null
          state_version: number
          status: Database["public"]["Enums"]["draft_pool_status"]
          submission_deadline_at: string | null
          submissions_published_at: string | null
          team_size_exact: number | null
          team_size_max: number | null
          team_size_min: number | null
          team_size_mode: string | null
          token_purchase_closes_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_point_cost?: number | null
          draft_type: Database["public"]["Enums"]["draft_type"]
          ended_at?: string | null
          engine?: string
          extension_seconds?: number[]
          extensions_enabled?: boolean
          id?: string
          kind?: string
          list_version_id?: string | null
          makeup_seconds?: number | null
          mode?: string
          parent_pool_id?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          phase?: string
          pick_order?: string
          pick_seconds?: number | null
          point_budget?: number | null
          pool_mode?: string
          publish_notified_at?: string | null
          publish_refused_at?: string | null
          publish_refused_version?: number | null
          quiet_end_hour?: number | null
          quiet_start_hour?: number | null
          quiet_timezone?: string | null
          redraft_lock_no_redraft_lines?: boolean
          redraft_max_lines?: number | null
          roster_size?: number | null
          season_group_id?: string | null
          season_id: string
          slow_ladder_seconds?: number[]
          started_at?: string | null
          state_version?: number
          status?: Database["public"]["Enums"]["draft_pool_status"]
          submission_deadline_at?: string | null
          submissions_published_at?: string | null
          team_size_exact?: number | null
          team_size_max?: number | null
          team_size_min?: number | null
          team_size_mode?: string | null
          token_purchase_closes_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_point_cost?: number | null
          draft_type?: Database["public"]["Enums"]["draft_type"]
          ended_at?: string | null
          engine?: string
          extension_seconds?: number[]
          extensions_enabled?: boolean
          id?: string
          kind?: string
          list_version_id?: string | null
          makeup_seconds?: number | null
          mode?: string
          parent_pool_id?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          phase?: string
          pick_order?: string
          pick_seconds?: number | null
          point_budget?: number | null
          pool_mode?: string
          publish_notified_at?: string | null
          publish_refused_at?: string | null
          publish_refused_version?: number | null
          quiet_end_hour?: number | null
          quiet_start_hour?: number | null
          quiet_timezone?: string | null
          redraft_lock_no_redraft_lines?: boolean
          redraft_max_lines?: number | null
          roster_size?: number | null
          season_group_id?: string | null
          season_id?: string
          slow_ladder_seconds?: number[]
          started_at?: string | null
          state_version?: number
          status?: Database["public"]["Enums"]["draft_pool_status"]
          submission_deadline_at?: string | null
          submissions_published_at?: string | null
          team_size_exact?: number | null
          team_size_max?: number | null
          team_size_min?: number | null
          team_size_mode?: string | null
          token_purchase_closes_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_pools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_pools_list_version_id_fkey"
            columns: ["list_version_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_pools_parent_pool_id_fkey"
            columns: ["parent_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_pools_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_pools_season_group_fkey"
            columns: ["season_group_id", "season_id"]
            isOneToOne: false
            referencedRelation: "season_groups"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "draft_pools_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_replay_events: {
        Row: {
          display_duration_ms: number
          draft_pool_id: string
          event_data: Json
          event_type: string
          id: string
          pick_id: string | null
          sequence_number: number
          wall_clock_time: string
        }
        Insert: {
          display_duration_ms?: number
          draft_pool_id: string
          event_data?: Json
          event_type: string
          id?: string
          pick_id?: string | null
          sequence_number: number
          wall_clock_time?: string
        }
        Update: {
          display_duration_ms?: number
          draft_pool_id?: string
          event_data?: Json
          event_type?: string
          id?: string
          pick_id?: string | null
          sequence_number?: number
          wall_clock_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_replay_events_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_replay_events_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "draft_picks"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_slots: {
        Row: {
          alert_kind: string | null
          alert_notified_at: string | null
          completed_at: string | null
          created_at: string
          deadline_at: string | null
          draft_pool_id: string
          extension_seconds: number
          id: string
          kind: string
          nominal_pick_number: number
          notified_turn_at: string | null
          origin_slot_id: string | null
          player_id: string
          previous_slot_id: string | null
          remaining_ms_at_pause: number | null
          reminder_mask: number
          round: number
          sort_key: number
          started_at: string | null
          status: string
          timeouts: number
          timer_seconds: number | null
        }
        Insert: {
          alert_kind?: string | null
          alert_notified_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string | null
          draft_pool_id: string
          extension_seconds?: number
          id?: string
          kind?: string
          nominal_pick_number: number
          notified_turn_at?: string | null
          origin_slot_id?: string | null
          player_id: string
          previous_slot_id?: string | null
          remaining_ms_at_pause?: number | null
          reminder_mask?: number
          round: number
          sort_key: number
          started_at?: string | null
          status?: string
          timeouts?: number
          timer_seconds?: number | null
        }
        Update: {
          alert_kind?: string | null
          alert_notified_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string | null
          draft_pool_id?: string
          extension_seconds?: number
          id?: string
          kind?: string
          nominal_pick_number?: number
          notified_turn_at?: string | null
          origin_slot_id?: string | null
          player_id?: string
          previous_slot_id?: string | null
          remaining_ms_at_pause?: number | null
          reminder_mask?: number
          round?: number
          sort_key?: number
          started_at?: string | null
          status?: string
          timeouts?: number
          timer_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_slots_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_slots_origin_slot_id_fkey"
            columns: ["origin_slot_id"]
            isOneToOne: false
            referencedRelation: "draft_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_slots_previous_slot_id_fkey"
            columns: ["previous_slot_id"]
            isOneToOne: false
            referencedRelation: "draft_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_tier_limits: {
        Row: {
          id: string
          max_picks: number
          power_tier: string
          season_id: string
        }
        Insert: {
          id?: string
          max_picks: number
          power_tier: string
          season_id: string
        }
        Update: {
          id?: string
          max_picks?: number
          power_tier?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_tier_limits_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      epb_animation_views: {
        Row: {
          id: string
          match_id: string
          player_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          match_id: string
          player_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          player_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "epb_animation_views_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_animation_views_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      epb_comeback_token_spends: {
        Row: {
          amount: number
          client_request_id: string
          created_at: string
          created_by: string | null
          id: string
          line_id: string
          player_id: string
          season_id: string
          tracker_id: string | null
        }
        Insert: {
          amount: number
          client_request_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          line_id: string
          player_id: string
          season_id: string
          tracker_id?: string | null
        }
        Update: {
          amount?: number
          client_request_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          line_id?: string
          player_id?: string
          season_id?: string
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "epb_comeback_token_spends_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_comeback_token_spends_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_comeback_token_spends_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_comeback_token_spends_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      epb_draft_token_purchases: {
        Row: {
          client_request_id: string
          created_at: string
          created_by: string | null
          id: string
          line_id: string
          player_id: string
          points_spent: number
          season_id: string
          tokens_used: number
          tracker_id: string | null
        }
        Insert: {
          client_request_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          line_id: string
          player_id: string
          points_spent: number
          season_id: string
          tokens_used?: number
          tracker_id?: string | null
        }
        Update: {
          client_request_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          line_id?: string
          player_id?: string
          points_spent?: number
          season_id?: string
          tokens_used?: number
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "epb_draft_token_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_draft_token_purchases_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_draft_token_purchases_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_draft_token_purchases_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      epb_kill_credit_epochs: {
        Row: {
          epoch: number
          season_id: string
        }
        Insert: {
          epoch?: number
          season_id: string
        }
        Update: {
          epoch?: number
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "epb_kill_credit_epochs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      epb_token_grants: {
        Row: {
          created_at: string
          created_by: string | null
          grant_type: string
          player_id: string
          season_id: string
          token_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grant_type: string
          player_id: string
          season_id: string
          token_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grant_type?: string
          player_id?: string
          season_id?: string
          token_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "epb_token_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_token_grants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epb_token_grants_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      evo_progress_log: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          matchday: number | null
          note: string | null
          season_id: string
          source: string
          tracker_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          matchday?: number | null
          note?: string | null
          season_id: string
          source: string
          tracker_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          matchday?: number | null
          note?: string | null
          season_id?: string
          source?: string
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evo_progress_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evo_progress_log_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evo_progress_log_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_events: {
        Row: {
          base_pokemon: string
          created_at: string
          id: string
          is_devolution: boolean
          is_manual: boolean
          matchday: number | null
          new_form: string
          new_stage: number
          player_id: string
          previous_form: string
          previous_stage: number | null
          season_id: string
          total_kos: number | null
          tracker_id: string | null
        }
        Insert: {
          base_pokemon: string
          created_at?: string
          id?: string
          is_devolution?: boolean
          is_manual?: boolean
          matchday?: number | null
          new_form: string
          new_stage: number
          player_id: string
          previous_form: string
          previous_stage?: number | null
          season_id: string
          total_kos?: number | null
          tracker_id?: string | null
        }
        Update: {
          base_pokemon?: string
          created_at?: string
          id?: string
          is_devolution?: boolean
          is_manual?: boolean
          matchday?: number | null
          new_form?: string
          new_stage?: number
          player_id?: string
          previous_form?: string
          previous_stage?: number | null
          season_id?: string
          total_kos?: number | null
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_events_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_tiers: {
        Row: {
          base_pokemon: string
          created_at: string
          id: string
          player_id: string | null
          power_tier: string | null
          season_id: string
          stage2_kos: number
          stage2_pokemon: string
          stage3_kos: number | null
          stage3_pokemon: string | null
        }
        Insert: {
          base_pokemon: string
          created_at?: string
          id?: string
          player_id?: string | null
          power_tier?: string | null
          season_id: string
          stage2_kos: number
          stage2_pokemon: string
          stage3_kos?: number | null
          stage3_pokemon?: string | null
        }
        Update: {
          base_pokemon?: string
          created_at?: string
          id?: string
          player_id?: string | null
          power_tier?: string | null
          season_id?: string
          stage2_kos?: number
          stage2_pokemon?: string
          stage3_kos?: number | null
          stage3_pokemon?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_tiers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_tiers_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_tracker: {
        Row: {
          base_pokemon: string
          cosmo_points: number
          created_at: string
          current_form: string
          current_stage: number
          draft_tokens: number
          evolution_points_awarded: number
          evolved_at: string | null
          id: string
          kill_tokens: number
          line_id: string | null
          locked_stage3_pokemon: string | null
          player_id: string
          real_kills: number
          redraft_slot_id: string | null
          season_group_id: string | null
          season_id: string
          suspended_until_matchday: number | null
          total_kos: number
          transferred_evo_progress: number
          updated_at: string
        }
        Insert: {
          base_pokemon: string
          cosmo_points?: number
          created_at?: string
          current_form: string
          current_stage?: number
          draft_tokens?: number
          evolution_points_awarded?: number
          evolved_at?: string | null
          id?: string
          kill_tokens?: number
          line_id?: string | null
          locked_stage3_pokemon?: string | null
          player_id: string
          real_kills?: number
          redraft_slot_id?: string | null
          season_group_id?: string | null
          season_id: string
          suspended_until_matchday?: number | null
          total_kos?: number
          transferred_evo_progress?: number
          updated_at?: string
        }
        Update: {
          base_pokemon?: string
          cosmo_points?: number
          created_at?: string
          current_form?: string
          current_stage?: number
          draft_tokens?: number
          evolution_points_awarded?: number
          evolved_at?: string | null
          id?: string
          kill_tokens?: number
          line_id?: string | null
          locked_stage3_pokemon?: string | null
          player_id?: string
          real_kills?: number
          redraft_slot_id?: string | null
          season_group_id?: string | null
          season_id?: string
          suspended_until_matchday?: number | null
          total_kos?: number
          transferred_evo_progress?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_tracker_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_tracker_redraft_slot_fkey"
            columns: ["redraft_slot_id"]
            isOneToOne: false
            referencedRelation: "redraft_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_tracker_season_group_fkey"
            columns: ["season_group_id", "season_id"]
            isOneToOne: false
            referencedRelation: "season_groups"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "evolution_tracker_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      format_definition_versions: {
        Row: {
          changelog: Json | null
          content_hash: string
          created_at: string
          created_by: string | null
          definition_id: string
          id: string
          schema_version: number
          spec: Json
          status: string
          version_no: number
        }
        Insert: {
          changelog?: Json | null
          content_hash: string
          created_at?: string
          created_by?: string | null
          definition_id: string
          id?: string
          schema_version: number
          spec: Json
          status?: string
          version_no: number
        }
        Update: {
          changelog?: Json | null
          content_hash?: string
          created_at?: string
          created_by?: string | null
          definition_id?: string
          id?: string
          schema_version?: number
          spec?: Json
          status?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "format_definition_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "format_definition_versions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "format_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      format_definitions: {
        Row: {
          created_at: string
          current_draft: Json
          current_version_id: string | null
          description: Json | null
          draft_rev: number
          forked_from: string | null
          id: string
          kind: string
          name: Json
          owner_id: string | null
          slug: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          current_draft: Json
          current_version_id?: string | null
          description?: Json | null
          draft_rev?: number
          forked_from?: string | null
          id?: string
          kind?: string
          name: Json
          owner_id?: string | null
          slug: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          current_draft?: Json
          current_version_id?: string | null
          description?: Json | null
          draft_rev?: number
          forked_from?: string | null
          id?: string
          kind?: string
          name?: Json
          owner_id?: string | null
          slug?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "format_definitions_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "format_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "format_definitions_forked_from_fkey"
            columns: ["forked_from"]
            isOneToOne: false
            referencedRelation: "format_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "format_definitions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      format_rules: {
        Row: {
          banned_items: string[]
          banned_moves: string[]
          comeback_spend_open: boolean
          created_at: string
          draft_budget: number
          draft_picks: number
          draft_token_max: number
          draft_token_max_per_line: number
          draft_token_ratio: number
          id: string
          redraft_phase_open: boolean
          season_id: string
          tera_rules: Json
          tiebreaker_order: string[]
        }
        Insert: {
          banned_items?: string[]
          banned_moves?: string[]
          comeback_spend_open?: boolean
          created_at?: string
          draft_budget?: number
          draft_picks?: number
          draft_token_max?: number
          draft_token_max_per_line?: number
          draft_token_ratio?: number
          id?: string
          redraft_phase_open?: boolean
          season_id: string
          tera_rules?: Json
          tiebreaker_order?: string[]
        }
        Update: {
          banned_items?: string[]
          banned_moves?: string[]
          comeback_spend_open?: boolean
          created_at?: string
          draft_budget?: number
          draft_picks?: number
          draft_token_max?: number
          draft_token_max_per_line?: number
          draft_token_ratio?: number
          id?: string
          redraft_phase_open?: boolean
          season_id?: string
          tera_rules?: Json
          tiebreaker_order?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "format_rules_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          aggregate_applied_at: string | null
          created_at: string
          edit_lease_token: string | null
          edit_lease_until: string | null
          evolution_applied_at: string | null
          evolution_credits: Json | null
          exclude_all_time: boolean
          game_number: number
          id: string
          match_id: string
          parsed: boolean
          replay_hash: string | null
          replay_url: string
          source: Database["public"]["Enums"]["game_source"]
          stats_locked: boolean
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          aggregate_applied_at?: string | null
          created_at?: string
          edit_lease_token?: string | null
          edit_lease_until?: string | null
          evolution_applied_at?: string | null
          evolution_credits?: Json | null
          exclude_all_time?: boolean
          game_number: number
          id?: string
          match_id: string
          parsed?: boolean
          replay_hash?: string | null
          replay_url?: string
          source?: Database["public"]["Enums"]["game_source"]
          stats_locked?: boolean
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          aggregate_applied_at?: string | null
          created_at?: string
          edit_lease_token?: string | null
          edit_lease_until?: string | null
          evolution_applied_at?: string | null
          evolution_credits?: Json | null
          exclude_all_time?: boolean
          game_number?: number
          id?: string
          match_id?: string
          parsed?: boolean
          replay_hash?: string | null
          replay_url?: string
          source?: Database["public"]["Enums"]["game_source"]
          stats_locked?: boolean
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      league_trash: {
        Row: {
          counts: Json
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          format_type: string
          frozen_pools: number
          id: string
          phase_ids: string[]
          player_ids: string[]
          purge_after: string
          rebuild_pending: boolean
          schema_version: string | null
          season_id: string
          season_name: string
          unlinked: Json
        }
        Insert: {
          counts?: Json
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          format_type: string
          frozen_pools?: number
          id?: string
          phase_ids?: string[]
          player_ids?: string[]
          purge_after: string
          rebuild_pending?: boolean
          schema_version?: string | null
          season_id: string
          season_name: string
          unlinked?: Json
        }
        Update: {
          counts?: Json
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          format_type?: string
          frozen_pools?: number
          id?: string
          phase_ids?: string[]
          player_ids?: string[]
          purge_after?: string
          rebuild_pending?: boolean
          schema_version?: string | null
          season_id?: string
          season_name?: string
          unlinked?: Json
        }
        Relationships: [
          {
            foreignKeyName: "league_trash_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      league_trash_players: {
        Row: {
          player_id: string
          trash_id: string
        }
        Insert: {
          player_id: string
          trash_id: string
        }
        Update: {
          player_id?: string
          trash_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_trash_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_trash_players_trash_id_fkey"
            columns: ["trash_id"]
            isOneToOne: false
            referencedRelation: "league_trash"
            referencedColumns: ["id"]
          },
        ]
      }
      league_trash_point_buy_versions: {
        Row: {
          list_version_id: string
          trash_id: string
        }
        Insert: {
          list_version_id: string
          trash_id: string
        }
        Update: {
          list_version_id?: string
          trash_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_trash_point_buy_versions_list_version_id_fkey"
            columns: ["list_version_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_trash_point_buy_versions_trash_id_fkey"
            columns: ["trash_id"]
            isOneToOne: false
            referencedRelation: "league_trash"
            referencedColumns: ["id"]
          },
        ]
      }
      league_trash_restore_rebuilds: {
        Row: {
          phase_ids: string[]
          player_ids: string[]
          restored_at: string
          season_id: string
          season_name: string
          trash_id: string
        }
        Insert: {
          phase_ids?: string[]
          player_ids?: string[]
          restored_at?: string
          season_id: string
          season_name: string
          trash_id: string
        }
        Update: {
          phase_ids?: string[]
          player_ids?: string[]
          restored_at?: string
          season_id?: string
          season_name?: string
          trash_id?: string
        }
        Relationships: []
      }
      league_trash_rulesets: {
        Row: {
          ruleset_id: string
          trash_id: string
        }
        Insert: {
          ruleset_id: string
          trash_id: string
        }
        Update: {
          ruleset_id?: string
          trash_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_trash_rulesets_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "ruleset_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_trash_rulesets_trash_id_fkey"
            columns: ["trash_id"]
            isOneToOne: false
            referencedRelation: "league_trash"
            referencedColumns: ["id"]
          },
        ]
      }
      league_trash_tables: {
        Row: {
          cols: Json
          n: number
          rel: string
          rows: Json
          trash_id: string
        }
        Insert: {
          cols: Json
          n: number
          rel: string
          rows: Json
          trash_id: string
        }
        Update: {
          cols?: Json
          n?: number
          rel?: string
          rows?: Json
          trash_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_trash_tables_trash_id_fkey"
            columns: ["trash_id"]
            isOneToOne: false
            referencedRelation: "league_trash"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_standings: {
        Row: {
          created_at: string
          draws: number
          games_played: number
          id: string
          kill_differential: number
          losses: number
          player_id: string
          points: number
          rank: number
          season_id: string
          wins: number
        }
        Insert: {
          created_at?: string
          draws?: number
          games_played?: number
          id?: string
          kill_differential?: number
          losses?: number
          player_id: string
          points?: number
          rank: number
          season_id: string
          wins?: number
        }
        Update: {
          created_at?: string
          draws?: number
          games_played?: number
          id?: string
          kill_differential?: number
          losses?: number
          player_id?: string
          points?: number
          rank?: number
          season_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_standings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_standings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      match_analyses: {
        Row: {
          analysis: Json
          completion_tokens: number | null
          created_at: string | null
          error: string | null
          generation_time_ms: number | null
          id: string
          match_id: string
          model_id: string
          prompt_tokens: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          analysis?: Json
          completion_tokens?: number | null
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          id?: string
          match_id: string
          model_id: string
          prompt_tokens?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          analysis?: Json
          completion_tokens?: number | null
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          id?: string
          match_id?: string
          model_id?: string
          prompt_tokens?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_analyses_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_evolution_snapshots: {
        Row: {
          base_pokemon: string
          brought: boolean
          cosmo_points_delta: number
          created_at: string
          draft_tokens_delta: number
          evolution_triggered: boolean
          id: string
          kill_tokens_delta: number
          line_id: string | null
          match_id: string
          player_id: string
          progress_after: number
          progress_before: number
          real_kos: number
          species_at_match: string
          stage_at_match: number
          suspension_triggered: boolean
          tracker_id: string | null
        }
        Insert: {
          base_pokemon: string
          brought?: boolean
          cosmo_points_delta?: number
          created_at?: string
          draft_tokens_delta?: number
          evolution_triggered?: boolean
          id?: string
          kill_tokens_delta?: number
          line_id?: string | null
          match_id: string
          player_id: string
          progress_after?: number
          progress_before?: number
          real_kos?: number
          species_at_match: string
          stage_at_match: number
          suspension_triggered?: boolean
          tracker_id?: string | null
        }
        Update: {
          base_pokemon?: string
          brought?: boolean
          cosmo_points_delta?: number
          created_at?: string
          draft_tokens_delta?: number
          evolution_triggered?: boolean
          id?: string
          kill_tokens_delta?: number
          line_id?: string | null
          match_id?: string
          player_id?: string
          progress_after?: number
          progress_before?: number
          real_kos?: number
          species_at_match?: string
          stage_at_match?: number
          suspension_triggered?: boolean
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_evolution_snapshots_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_evolution_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_evolution_snapshots_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      match_prep_analyses: {
        Row: {
          analysis: Json
          completion_tokens: number | null
          created_at: string | null
          error: string | null
          generation_time_ms: number | null
          has_user_team: boolean
          id: string
          match_id: string
          model_id: string
          player_id: string
          prompt_tokens: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          analysis?: Json
          completion_tokens?: number | null
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          has_user_team?: boolean
          id?: string
          match_id: string
          model_id: string
          player_id: string
          prompt_tokens?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          analysis?: Json
          completion_tokens?: number | null
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          has_user_team?: boolean
          id?: string
          match_id?: string
          model_id?: string
          player_id?: string
          prompt_tokens?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_prep_analyses_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_prep_analyses_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      match_prep_teams: {
        Row: {
          created_at: string
          id: string
          import_source: Database["public"]["Enums"]["team_import_source"]
          match_id: string
          player_id: string
          pokemon: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          import_source?: Database["public"]["Enums"]["team_import_source"]
          match_id: string
          player_id: string
          pokemon?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          import_source?: Database["public"]["Enums"]["team_import_source"]
          match_id?: string
          player_id?: string
          pokemon?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_prep_teams_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_prep_teams_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      match_proposals: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          match_id: string
          message: string
          proposed_at: string
          proposer_id: string
          responded_at: string | null
          responder_id: string
          status: Database["public"]["Enums"]["match_proposal_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          match_id: string
          message?: string
          proposed_at: string
          proposer_id: string
          responded_at?: string | null
          responder_id: string
          status?: Database["public"]["Enums"]["match_proposal_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          match_id?: string
          message?: string
          proposed_at?: string
          proposer_id?: string
          responded_at?: string | null
          responder_id?: string
          status?: Database["public"]["Enums"]["match_proposal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_proposals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_proposals_proposer_id_fkey"
            columns: ["proposer_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_proposals_responder_id_fkey"
            columns: ["responder_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          auto_confirm_at: string | null
          bracket_pos: number | null
          bracket_side: string | null
          confirmed_at: string | null
          created_at: string
          date_played: string | null
          finalized_at: string | null
          id: string
          notes: string
          player_1_id: string
          player_2_id: string
          round_id: string
          scheduled_at: string | null
          social_image_url: string | null
          status: Database["public"]["Enums"]["match_status"]
          submitter_id: string | null
          tournament_id: string
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          auto_confirm_at?: string | null
          bracket_pos?: number | null
          bracket_side?: string | null
          confirmed_at?: string | null
          created_at?: string
          date_played?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string
          player_1_id: string
          player_2_id: string
          round_id: string
          scheduled_at?: string | null
          social_image_url?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          submitter_id?: string | null
          tournament_id: string
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          auto_confirm_at?: string | null
          bracket_pos?: number | null
          bracket_side?: string | null
          confirmed_at?: string | null
          created_at?: string
          date_played?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string
          player_1_id?: string
          player_2_id?: string
          round_id?: string
          scheduled_at?: string | null
          social_image_url?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          submitter_id?: string | null
          tournament_id?: string
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_player_1_id_fkey"
            columns: ["player_1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_2_id_fkey"
            columns: ["player_2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_usage_cache: {
        Row: {
          abilities: Json
          counters: Json | null
          format: string
          id: string
          items: Json
          last_imported: string
          lead_pct: number | null
          moves: Json
          pokemon_name: string
          spreads: Json
          teammates: Json
          tera_types: Json | null
          usage_pct: number
          viability: Json | null
        }
        Insert: {
          abilities?: Json
          counters?: Json | null
          format: string
          id?: string
          items?: Json
          last_imported?: string
          lead_pct?: number | null
          moves?: Json
          pokemon_name: string
          spreads?: Json
          teammates?: Json
          tera_types?: Json | null
          usage_pct: number
          viability?: Json | null
        }
        Update: {
          abilities?: Json
          counters?: Json | null
          format?: string
          id?: string
          items?: Json
          last_imported?: string
          lead_pct?: number | null
          moves?: Json
          pokemon_name?: string
          spreads?: Json
          teammates?: Json
          tera_types?: Json | null
          usage_pct?: number
          viability?: Json | null
        }
        Relationships: []
      }
      player_achievements: {
        Row: {
          achievement_id: string
          context: Json | null
          earned_at: string
          id: string
          player_id: string
          times_earned: number
        }
        Insert: {
          achievement_id: string
          context?: Json | null
          earned_at?: string
          id?: string
          player_id: string
          times_earned?: number
        }
        Update: {
          achievement_id?: string
          context?: Json | null
          earned_at?: string
          id?: string
          player_id?: string
          times_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievement_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_achievements_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_aggregates: {
        Row: {
          id: string
          last_updated: string
          move_counts: Json
          player_id: string
          pokemon_name: string
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances: number
          total_brought: number
          total_games: number
          total_koed: number
          total_kos_dealt: number
          total_led: number
          total_wins: number
        }
        Insert: {
          id?: string
          last_updated?: string
          move_counts?: Json
          player_id: string
          pokemon_name: string
          scope_id?: string | null
          scope_type: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances?: number
          total_brought?: number
          total_games?: number
          total_koed?: number
          total_kos_dealt?: number
          total_led?: number
          total_wins?: number
        }
        Update: {
          id?: string
          last_updated?: string
          move_counts?: Json
          player_id?: string
          pokemon_name?: string
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["aggregate_scope"]
          total_appearances?: number
          total_brought?: number
          total_games?: number
          total_koed?: number
          total_kos_dealt?: number
          total_led?: number
          total_wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_aggregates_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_claim_disposable_refs: {
        Row: {
          reason: string
          table_ref: unknown
        }
        Insert: {
          reason: string
          table_ref: unknown
        }
        Update: {
          reason?: string
          table_ref?: unknown
        }
        Relationships: []
      }
      player_ratings: {
        Row: {
          created_at: string
          draws: number
          id: string
          last_match_at: string | null
          losses: number
          peak_date: string | null
          peak_rating: number
          player_id: string
          rating: number
          rd: number
          updated_at: string
          volatility: number
          wins: number
        }
        Insert: {
          created_at?: string
          draws?: number
          id?: string
          last_match_at?: string | null
          losses?: number
          peak_date?: string | null
          peak_rating?: number
          player_id: string
          rating?: number
          rd?: number
          updated_at?: string
          volatility?: number
          wins?: number
        }
        Update: {
          created_at?: string
          draws?: number
          id?: string
          last_match_at?: string | null
          losses?: number
          peak_date?: string | null
          peak_rating?: number
          player_id?: string
          rating?: number
          rd?: number
          updated_at?: string
          volatility?: number
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_signatures: {
        Row: {
          id: string
          player_id: string
          signatures: Json
          updated_at: string
        }
        Insert: {
          id?: string
          player_id: string
          signatures?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          player_id?: string
          signatures?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_signatures_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_streaks: {
        Row: {
          best_flawless_streak: number
          best_ko_streak: number
          best_loss_streak: number
          best_win_streak: number
          current_flawless_streak: number
          current_ko_streak: number
          current_loss_streak: number
          current_win_streak: number
          id: string
          last_match_id: string | null
          player_id: string
          updated_at: string
        }
        Insert: {
          best_flawless_streak?: number
          best_ko_streak?: number
          best_loss_streak?: number
          best_win_streak?: number
          current_flawless_streak?: number
          current_ko_streak?: number
          current_loss_streak?: number
          current_win_streak?: number
          id?: string
          last_match_id?: string | null
          player_id: string
          updated_at?: string
        }
        Update: {
          best_flawless_streak?: number
          best_ko_streak?: number
          best_loss_streak?: number
          best_win_streak?: number
          current_flawless_streak?: number
          current_ko_streak?: number
          current_loss_streak?: number
          current_win_streak?: number
          id?: string
          last_match_id?: string | null
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_streaks_last_match_id_fkey"
            columns: ["last_match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_streaks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          auth_user_id: string | null
          avatar_config: Json | null
          avatar_url: string | null
          ban_reason: string | null
          champions_username: string
          created_at: string
          discord_id: string | null
          id: string
          is_admin: boolean
          is_creator: boolean
          is_guest: boolean
          is_test_account: boolean
          joined_date: string
          name: string
          ps_username: string
          sprite_style: string
          status: string
          suspended_until: string | null
          updated_at: string
          world_experience: string
        }
        Insert: {
          auth_user_id?: string | null
          avatar_config?: Json | null
          avatar_url?: string | null
          ban_reason?: string | null
          champions_username?: string
          created_at?: string
          discord_id?: string | null
          id?: string
          is_admin?: boolean
          is_creator?: boolean
          is_guest?: boolean
          is_test_account?: boolean
          joined_date?: string
          name: string
          ps_username?: string
          sprite_style?: string
          status?: string
          suspended_until?: string | null
          updated_at?: string
          world_experience?: string
        }
        Update: {
          auth_user_id?: string | null
          avatar_config?: Json | null
          avatar_url?: string | null
          ban_reason?: string | null
          champions_username?: string
          created_at?: string
          discord_id?: string | null
          id?: string
          is_admin?: boolean
          is_creator?: boolean
          is_guest?: boolean
          is_test_account?: boolean
          joined_date?: string
          name?: string
          ps_username?: string
          sprite_style?: string
          status?: string
          suspended_until?: string | null
          updated_at?: string
          world_experience?: string
        }
        Relationships: []
      }
      point_buy_list_entries: {
        Row: {
          additional_kills_to_stage3: number | null
          base_pokemon: string
          early_rating: number | null
          historical_data: string | null
          id: string
          kills_to_stage2: number
          late_rating: number | null
          legacy_tier: string | null
          line_id: string
          line_number: number
          list_version_id: string
          mid_rating: number | null
          price: number
          price_group: string
          rationale: string | null
          sources: string | null
          special_rules: Json | null
          special_rules_text: string | null
          species_ids: Json | null
          stage2_pokemon: string
          stage3_pokemon: string | null
        }
        Insert: {
          additional_kills_to_stage3?: number | null
          base_pokemon: string
          early_rating?: number | null
          historical_data?: string | null
          id?: string
          kills_to_stage2: number
          late_rating?: number | null
          legacy_tier?: string | null
          line_id: string
          line_number: number
          list_version_id: string
          mid_rating?: number | null
          price: number
          price_group: string
          rationale?: string | null
          sources?: string | null
          special_rules?: Json | null
          special_rules_text?: string | null
          species_ids?: Json | null
          stage2_pokemon: string
          stage3_pokemon?: string | null
        }
        Update: {
          additional_kills_to_stage3?: number | null
          base_pokemon?: string
          early_rating?: number | null
          historical_data?: string | null
          id?: string
          kills_to_stage2?: number
          late_rating?: number | null
          legacy_tier?: string | null
          line_id?: string
          line_number?: number
          list_version_id?: string
          mid_rating?: number | null
          price?: number
          price_group?: string
          rationale?: string | null
          sources?: string | null
          special_rules?: Json | null
          special_rules_text?: string | null
          species_ids?: Json | null
          stage2_pokemon?: string
          stage3_pokemon?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_buy_list_entries_list_version_id_fkey"
            columns: ["list_version_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      point_buy_list_versions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          source: string | null
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          source?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          source?: string | null
          version?: number
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          locale: string
          p256dh: string
          player_id: string
          user_agent_label: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          locale?: string
          p256dh: string
          player_id: string
          user_agent_label?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          locale?: string
          p256dh?: string
          player_id?: string
          user_agent_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          hits: number
          key: string
          window_end: string
          window_start: string
        }
        Insert: {
          hits: number
          key: string
          window_end: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      rating_history: {
        Row: {
          id: string
          match_id: string
          opponent_id: string
          opponent_rating: number
          player_id: string
          rating_after: number
          rating_before: number
          rating_change: number | null
          rd_after: number
          rd_before: number
          recorded_at: string
          result: string
        }
        Insert: {
          id?: string
          match_id: string
          opponent_id: string
          opponent_rating: number
          player_id: string
          rating_after: number
          rating_before: number
          rating_change?: number | null
          rd_after: number
          rd_before: number
          recorded_at?: string
          result: string
        }
        Update: {
          id?: string
          match_id?: string
          opponent_id?: string
          opponent_rating?: number
          player_id?: string
          rating_after?: number
          rating_before?: number
          rating_change?: number | null
          rd_after?: number
          rd_before?: number
          recorded_at?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "rating_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_history_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      redraft_history: {
        Row: {
          created_at: string
          draft_pool_id: string | null
          dropped_line_id: string | null
          from_tracker_id: string | null
          id: string
          missing_kills_transferred: number
          player_id: string
          points_refunded: number | null
          points_spent: number
          season_id: string
          to_base_pokemon: string
          to_stage3_pokemon: string | null
          trade_partner_id: string | null
          transfer_type: string
          transferred_real_kills: number | null
        }
        Insert: {
          created_at?: string
          draft_pool_id?: string | null
          dropped_line_id?: string | null
          from_tracker_id?: string | null
          id?: string
          missing_kills_transferred?: number
          player_id: string
          points_refunded?: number | null
          points_spent?: number
          season_id: string
          to_base_pokemon: string
          to_stage3_pokemon?: string | null
          trade_partner_id?: string | null
          transfer_type: string
          transferred_real_kills?: number | null
        }
        Update: {
          created_at?: string
          draft_pool_id?: string | null
          dropped_line_id?: string | null
          from_tracker_id?: string | null
          id?: string
          missing_kills_transferred?: number
          player_id?: string
          points_refunded?: number | null
          points_spent?: number
          season_id?: string
          to_base_pokemon?: string
          to_stage3_pokemon?: string | null
          trade_partner_id?: string | null
          transfer_type?: string
          transferred_real_kills?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "redraft_history_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_history_from_tracker_id_fkey"
            columns: ["from_tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_history_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_history_trade_partner_id_fkey"
            columns: ["trade_partner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      redraft_slots: {
        Row: {
          created_at: string
          draft_pool_id: string
          dropped_entry_id: string | null
          dropped_line_id: string
          dropped_price: number
          dropped_stage: number
          dropped_tracker_snapshot: Json
          filled_by_pick_id: string | null
          id: string
          label: string
          player_id: string
          season_id: string
          transferred_real_kills: number
        }
        Insert: {
          created_at?: string
          draft_pool_id: string
          dropped_entry_id?: string | null
          dropped_line_id: string
          dropped_price: number
          dropped_stage: number
          dropped_tracker_snapshot: Json
          filled_by_pick_id?: string | null
          id?: string
          label: string
          player_id: string
          season_id: string
          transferred_real_kills: number
        }
        Update: {
          created_at?: string
          draft_pool_id?: string
          dropped_entry_id?: string | null
          dropped_line_id?: string
          dropped_price?: number
          dropped_stage?: number
          dropped_tracker_snapshot?: Json
          filled_by_pick_id?: string | null
          id?: string
          label?: string
          player_id?: string
          season_id?: string
          transferred_real_kills?: number
        }
        Relationships: [
          {
            foreignKeyName: "redraft_slots_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_slots_dropped_entry_id_fkey"
            columns: ["dropped_entry_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_slots_filled_by_pick_id_fkey"
            columns: ["filled_by_pick_id"]
            isOneToOne: false
            referencedRelation: "draft_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_slots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      redraft_submissions: {
        Row: {
          draft_pool_id: string
          line_id: string
          player_id: string
          tracker_id: string
          updated_at: string
        }
        Insert: {
          draft_pool_id: string
          line_id: string
          player_id: string
          tracker_id: string
          updated_at?: string
        }
        Update: {
          draft_pool_id?: string
          line_id?: string
          player_id?: string
          tracker_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "redraft_submissions_draft_pool_id_fkey"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_submissions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_submissions_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      redraft_trade_requests: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          consent_a: boolean
          consent_b: boolean
          created_at: string
          executed_at: string | null
          executed_tracker_ids: Json | null
          from_tracker_a_id: string | null
          from_tracker_b_id: string | null
          id: string
          initiated_by: string
          line_a: string
          line_b: string
          player_a_id: string
          player_b_id: string
          season_id: string
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          consent_a?: boolean
          consent_b?: boolean
          created_at?: string
          executed_at?: string | null
          executed_tracker_ids?: Json | null
          from_tracker_a_id?: string | null
          from_tracker_b_id?: string | null
          id?: string
          initiated_by: string
          line_a: string
          line_b: string
          player_a_id: string
          player_b_id: string
          season_id: string
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          consent_a?: boolean
          consent_b?: boolean
          created_at?: string
          executed_at?: string | null
          executed_tracker_ids?: Json | null
          from_tracker_a_id?: string | null
          from_tracker_b_id?: string | null
          id?: string
          initiated_by?: string
          line_a?: string
          line_b?: string
          player_a_id?: string
          player_b_id?: string
          season_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "redraft_trade_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_from_tracker_a_id_fkey"
            columns: ["from_tracker_a_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_from_tracker_b_id_fkey"
            columns: ["from_tracker_b_id"]
            isOneToOne: false
            referencedRelation: "evolution_tracker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_player_a_id_fkey"
            columns: ["player_a_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_player_b_id_fkey"
            columns: ["player_b_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redraft_trade_requests_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_admins: {
        Row: {
          created_at: string
          id: string
          player_id: string
          resource_id: string
          resource_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          resource_id: string
          resource_type: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          resource_id?: string
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_admins_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          best_of: number
          bracket_side: string | null
          bye_player_ids: string[]
          created_at: string
          deadline: string | null
          id: string
          name: string
          pairings_generated: boolean
          round_number: number
          status: Database["public"]["Enums"]["round_status"]
          tournament_id: string
          updated_at: string
        }
        Insert: {
          best_of: number
          bracket_side?: string | null
          bye_player_ids?: string[]
          created_at?: string
          deadline?: string | null
          id?: string
          name: string
          pairings_generated?: boolean
          round_number: number
          status?: Database["public"]["Enums"]["round_status"]
          tournament_id: string
          updated_at?: string
        }
        Update: {
          best_of?: number
          bracket_side?: string | null
          bye_player_ids?: string[]
          created_at?: string
          deadline?: string | null
          id?: string
          name?: string
          pairings_generated?: boolean
          round_number?: number
          status?: Database["public"]["Enums"]["round_status"]
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rounds_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      ruleset_definition_versions: {
        Row: {
          catalog_version: string
          changelog: Json | null
          content_hash: string
          created_at: string
          created_by: string | null
          definition_id: string
          format_key: string
          gen: number
          id: string
          is_doubles: boolean
          name_text: string
          resolved: Json
          resolved_hash: string
          schema_version: number
          spec: Json
          version_no: number
        }
        Insert: {
          catalog_version: string
          changelog?: Json | null
          content_hash: string
          created_at?: string
          created_by?: string | null
          definition_id: string
          format_key: string
          gen: number
          id?: string
          is_doubles: boolean
          name_text: string
          resolved: Json
          resolved_hash: string
          schema_version: number
          spec: Json
          version_no: number
        }
        Update: {
          catalog_version?: string
          changelog?: Json | null
          content_hash?: string
          created_at?: string
          created_by?: string | null
          definition_id?: string
          format_key?: string
          gen?: number
          id?: string
          is_doubles?: boolean
          name_text?: string
          resolved?: Json
          resolved_hash?: string
          schema_version?: number
          spec?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "ruleset_definition_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruleset_definition_versions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "ruleset_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      ruleset_definitions: {
        Row: {
          created_at: string
          current_draft: Json
          current_version_id: string | null
          description: Json | null
          draft_rev: number
          forked_from: string | null
          id: string
          kind: string
          name: Json
          name_text: string | null
          owner_id: string | null
          season_id: string | null
          slug: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          current_draft: Json
          current_version_id?: string | null
          description?: Json | null
          draft_rev?: number
          forked_from?: string | null
          id?: string
          kind?: string
          name: Json
          name_text?: string | null
          owner_id?: string | null
          season_id?: string | null
          slug: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          current_draft?: Json
          current_version_id?: string | null
          description?: Json | null
          draft_rev?: number
          forked_from?: string | null
          id?: string
          kind?: string
          name?: Json
          name_text?: string | null
          owner_id?: string | null
          season_id?: string | null
          slug?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruleset_definitions_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "ruleset_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruleset_definitions_forked_from_fkey"
            columns: ["forked_from"]
            isOneToOne: false
            referencedRelation: "ruleset_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruleset_definitions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      ruleset_pin_backfill_log: {
        Row: {
          created_at: string
          id: number
          kind: string
          new_ruleset_id: string
          old_ruleset_id: string
          step: string
          target_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          new_ruleset_id: string
          old_ruleset_id: string
          step: string
          target_id: string
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          new_ruleset_id?: string
          old_ruleset_id?: string
          step?: string
          target_id?: string
        }
        Relationships: []
      }
      rulesets_legacy: {
        Row: {
          added_pokemon: string[]
          banned_abilities: string[]
          banned_items: string[]
          banned_moves: string[]
          banned_pokemon: string[]
          base_format: string
          clauses: string[]
          created_at: string
          created_by: string | null
          custom_rules_string: string
          id: string
          is_doubles: boolean
          min_shared_type_pct: number
          name: string
          team_constraints: Json | null
          updated_at: string
        }
        Insert: {
          added_pokemon?: string[]
          banned_abilities?: string[]
          banned_items?: string[]
          banned_moves?: string[]
          banned_pokemon?: string[]
          base_format?: string
          clauses?: string[]
          created_at?: string
          created_by?: string | null
          custom_rules_string?: string
          id?: string
          is_doubles?: boolean
          min_shared_type_pct?: number
          name: string
          team_constraints?: Json | null
          updated_at?: string
        }
        Update: {
          added_pokemon?: string[]
          banned_abilities?: string[]
          banned_items?: string[]
          banned_moves?: string[]
          banned_pokemon?: string[]
          base_format?: string
          clauses?: string[]
          created_at?: string
          created_by?: string | null
          custom_rules_string?: string
          id?: string
          is_doubles?: boolean
          min_shared_type_pct?: number
          name?: string
          team_constraints?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rulesets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      season_formats: {
        Row: {
          amendments: Json
          definition_id: string | null
          engine: string
          frozen_at: string
          preset_rulesets: Json
          season_id: string
          seed: string
          spec: Json
          spec_hash: string
          tunables: Json
          version_no: number
        }
        Insert: {
          amendments?: Json
          definition_id?: string | null
          engine?: string
          frozen_at?: string
          preset_rulesets?: Json
          season_id: string
          seed: string
          spec: Json
          spec_hash: string
          tunables?: Json
          version_no: number
        }
        Update: {
          amendments?: Json
          definition_id?: string | null
          engine?: string
          frozen_at?: string
          preset_rulesets?: Json
          season_id?: string
          seed?: string
          spec?: Json
          spec_hash?: string
          tunables?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_formats_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "format_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_formats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_group_members: {
        Row: {
          created_at: string
          group_id: string
          player_id: string
          season_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          player_id: string
          season_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          player_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_group_members_group_fkey"
            columns: ["group_id", "season_id"]
            isOneToOne: false
            referencedRelation: "season_groups"
            referencedColumns: ["id", "season_id"]
          },
          {
            foreignKeyName: "season_group_members_participant_fkey"
            columns: ["season_id", "player_id"]
            isOneToOne: true
            referencedRelation: "season_participants"
            referencedColumns: ["season_id", "player_id"]
          },
        ]
      }
      season_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          season_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          season_id: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          season_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_groups_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_participants: {
        Row: {
          core_assigned_at: string | null
          core_types: string[] | null
          gym_type: string | null
          player_id: string
          season_id: string
        }
        Insert: {
          core_assigned_at?: string | null
          core_types?: string[] | null
          gym_type?: string | null
          player_id: string
          season_id: string
        }
        Update: {
          core_assigned_at?: string | null
          core_types?: string[] | null
          gym_type?: string | null
          player_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_participants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_participants_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_storylines: {
        Row: {
          body: string
          created_at: string | null
          created_by: string | null
          featured: boolean | null
          id: string
          season_id: string
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by?: string | null
          featured?: boolean | null
          id?: string
          season_id: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string | null
          featured?: boolean | null
          id?: string
          season_id?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_storylines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_storylines_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          archived: boolean
          core_pool: Json | null
          created_at: string
          description: string
          end_date: string | null
          format_type: Database["public"]["Enums"]["season_format_type"]
          id: string
          is_test_season: boolean
          language: string
          legacy: boolean
          name: string
          point_buy_list_id: string | null
          route_theme: string
          ruleset_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["season_status"]
          updated_at: string
        }
        Insert: {
          archived?: boolean
          core_pool?: Json | null
          created_at?: string
          description?: string
          end_date?: string | null
          format_type: Database["public"]["Enums"]["season_format_type"]
          id?: string
          is_test_season?: boolean
          language?: string
          legacy?: boolean
          name: string
          point_buy_list_id?: string | null
          route_theme?: string
          ruleset_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status"]
          updated_at?: string
        }
        Update: {
          archived?: boolean
          core_pool?: Json | null
          created_at?: string
          description?: string
          end_date?: string | null
          format_type?: Database["public"]["Enums"]["season_format_type"]
          id?: string
          is_test_season?: boolean
          language?: string
          legacy?: boolean
          name?: string
          point_buy_list_id?: string | null
          route_theme?: string
          ruleset_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_point_buy_list_id_fkey"
            columns: ["point_buy_list_id"]
            isOneToOne: false
            referencedRelation: "point_buy_list_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "ruleset_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      smogon_sample_sets: {
        Row: {
          description: string | null
          format: string
          generation: number
          id: string
          last_imported: string
          moveset: Json
          outdated: boolean | null
          pokemon_name: string
          set_name: string
        }
        Insert: {
          description?: string | null
          format: string
          generation: number
          id?: string
          last_imported?: string
          moveset: Json
          outdated?: boolean | null
          pokemon_name: string
          set_name: string
        }
        Update: {
          description?: string | null
          format?: string
          generation?: number
          id?: string
          last_imported?: string
          moveset?: Json
          outdated?: boolean | null
          pokemon_name?: string
          set_name?: string
        }
        Relationships: []
      }
      social_integrations: {
        Row: {
          created_at: string
          credential_hint: string | null
          credentials_encrypted: string | null
          enabled: boolean
          event_filter: string[]
          id: string
          label: string
          post_options: Json
          provider: string
          scope_id: string | null
          scope_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credential_hint?: string | null
          credentials_encrypted?: string | null
          enabled?: boolean
          event_filter?: string[]
          id?: string
          label: string
          post_options?: Json
          provider: string
          scope_id?: string | null
          scope_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credential_hint?: string | null
          credentials_encrypted?: string | null
          enabled?: boolean
          event_filter?: string[]
          id?: string
          label?: string
          post_options?: Json
          provider?: string
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_roles: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          move_name: string
          source: string | null
          species_form: string
          stage: number | null
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          move_name: string
          source?: string | null
          species_form: string
          stage?: number | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          move_name?: string
          source?: string | null
          species_form?: string
          stage?: number | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          draft_pool_id: string | null
          forked_from_team_id: string | null
          id: string
          import_source: Database["public"]["Enums"]["team_import_source"]
          is_draft_team: boolean
          library_description: string | null
          library_published_at: string | null
          library_tags: string[] | null
          library_title: string | null
          locked: boolean
          match_id: string | null
          name: string
          player_id: string
          pokemon: Json
          season_id: string | null
          share_enabled_at: string | null
          share_token: string | null
          tournament_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_pool_id?: string | null
          forked_from_team_id?: string | null
          id?: string
          import_source?: Database["public"]["Enums"]["team_import_source"]
          is_draft_team?: boolean
          library_description?: string | null
          library_published_at?: string | null
          library_tags?: string[] | null
          library_title?: string | null
          locked?: boolean
          match_id?: string | null
          name?: string
          player_id: string
          pokemon?: Json
          season_id?: string | null
          share_enabled_at?: string | null
          share_token?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_pool_id?: string | null
          forked_from_team_id?: string | null
          id?: string
          import_source?: Database["public"]["Enums"]["team_import_source"]
          is_draft_team?: boolean
          library_description?: string | null
          library_published_at?: string | null
          library_tags?: string[] | null
          library_title?: string | null
          locked?: boolean
          match_id?: string | null
          name?: string
          player_id?: string
          pokemon?: Json
          season_id?: string | null
          share_enabled_at?: string | null
          share_token?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_teams_draft_pool"
            columns: ["draft_pool_id"]
            isOneToOne: false
            referencedRelation: "draft_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_forked_from_team_id_fkey"
            columns: ["forked_from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_group_members: {
        Row: {
          group_id: string
          player_id: string
          seed: number
        }
        Insert: {
          group_id: string
          player_id: string
          seed?: number
        }
        Update: {
          group_id?: string
          player_id?: string
          seed?: number
        }
        Relationships: [
          {
            foreignKeyName: "tournament_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "tournament_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_group_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_groups: {
        Row: {
          created_at: string
          group_number: number
          id: string
          name: string
          season_group_id: string | null
          tournament_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_number: number
          id?: string
          name: string
          season_group_id?: string | null
          tournament_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_number?: number
          id?: string
          name?: string
          season_group_id?: string | null
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_groups_season_group_id_fkey"
            columns: ["season_group_id"]
            isOneToOne: false
            referencedRelation: "season_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_groups_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_participants: {
        Row: {
          player_id: string
          seed: number | null
          starting_bracket: string
          tournament_id: string
        }
        Insert: {
          player_id: string
          seed?: number | null
          starting_bracket?: string
          tournament_id: string
        }
        Update: {
          player_id?: string
          seed?: number | null
          starting_bracket?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_participants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_reports: {
        Row: {
          completion_tokens: number | null
          content: Json
          created_at: string | null
          error: string | null
          generation_time_ms: number | null
          id: string
          model_id: string
          prompt_tokens: number | null
          report_type: string
          round_id: string
          status: string
          tournament_id: string
          updated_at: string | null
        }
        Insert: {
          completion_tokens?: number | null
          content?: Json
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          id?: string
          model_id: string
          prompt_tokens?: number | null
          report_type: string
          round_id: string
          status?: string
          tournament_id: string
          updated_at?: string | null
        }
        Update: {
          completion_tokens?: number | null
          content?: Json
          created_at?: string | null
          error?: string | null
          generation_time_ms?: number | null
          id?: string
          model_id?: string
          prompt_tokens?: number | null
          report_type?: string
          round_id?: string
          status?: string
          tournament_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_reports_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_reports_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          advancement_rule: Json | null
          archived: boolean
          best_of_default: number
          bo_overrides: Json
          bracket_reset_enabled: boolean
          bracket_type: Database["public"]["Enums"]["bracket_type"]
          created_at: string
          current_round: number
          description: string
          enrollment_source: Json | null
          format_stage_key: string | null
          id: string
          is_doubles: boolean
          legacy: boolean
          name: string
          ruleset_id: string
          season_id: string | null
          stage_order: number
          stage_spec: Json | null
          status: Database["public"]["Enums"]["tournament_status"]
          team_visibility: Database["public"]["Enums"]["team_visibility"]
          updated_at: string
        }
        Insert: {
          advancement_rule?: Json | null
          archived?: boolean
          best_of_default?: number
          bo_overrides?: Json
          bracket_reset_enabled?: boolean
          bracket_type: Database["public"]["Enums"]["bracket_type"]
          created_at?: string
          current_round?: number
          description?: string
          enrollment_source?: Json | null
          format_stage_key?: string | null
          id?: string
          is_doubles?: boolean
          legacy?: boolean
          name: string
          ruleset_id: string
          season_id?: string | null
          stage_order?: number
          stage_spec?: Json | null
          status?: Database["public"]["Enums"]["tournament_status"]
          team_visibility?: Database["public"]["Enums"]["team_visibility"]
          updated_at?: string
        }
        Update: {
          advancement_rule?: Json | null
          archived?: boolean
          best_of_default?: number
          bo_overrides?: Json
          bracket_reset_enabled?: boolean
          bracket_type?: Database["public"]["Enums"]["bracket_type"]
          created_at?: string
          current_round?: number
          description?: string
          enrollment_source?: Json | null
          format_stage_key?: string | null
          id?: string
          is_doubles?: boolean
          legacy?: boolean
          name?: string
          ruleset_id?: string
          season_id?: string | null
          stage_order?: number
          stage_spec?: Json | null
          status?: Database["public"]["Enums"]["tournament_status"]
          team_visibility?: Database["public"]["Enums"]["team_visibility"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_ruleset_id_fkey"
            columns: ["ruleset_id"]
            isOneToOne: false
            referencedRelation: "ruleset_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_avatars_3d: {
        Row: {
          config: Json
          player_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          player_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_avatars_3d_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      user_agent_profile: {
        Row: {
          created_at: string
          default_persona: string
          favorite_pokemon: string[] | null
          model_priority: Json
          opt_in_data_collection: boolean
          play_style_tags: string[] | null
          player_id: string
          preferred_formats: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_persona?: string
          favorite_pokemon?: string[] | null
          model_priority?: Json
          opt_in_data_collection?: boolean
          play_style_tags?: string[] | null
          player_id: string
          preferred_formats?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_persona?: string
          favorite_pokemon?: string[] | null
          model_priority?: Json
          opt_in_data_collection?: boolean
          play_style_tags?: string[] | null
          player_id?: string
          preferred_formats?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_agent_profile_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_note_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          note_id: string
          reason: string
          reporter_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          note_id: string
          reason: string
          reporter_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          note_id?: string
          reason?: string
          reporter_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_note_reports_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "wiki_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_note_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_notes: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          author_id: string
          content: string
          created_at: string
          entity_name: string
          entity_type: string
          id: string
          moderation_flags: string[]
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          resubmission_blocked_at: string | null
          resubmission_blocked_by: string | null
          scope_id: string | null
          scope_type: string
          updated_at: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          author_id: string
          content: string
          created_at?: string
          entity_name: string
          entity_type: string
          id?: string
          moderation_flags?: string[]
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          resubmission_blocked_at?: string | null
          resubmission_blocked_by?: string | null
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          author_id?: string
          content?: string
          created_at?: string
          entity_name?: string
          entity_type?: string
          id?: string
          moderation_flags?: string[]
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          resubmission_blocked_at?: string | null
          resubmission_blocked_by?: string | null
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_notes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_notes_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_notes_resubmission_blocked_by_fkey"
            columns: ["resubmission_blocked_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_job_health: {
        Args: never
        Returns: {
          stale_processing: number
          stranded_pending: number
        }[]
      }
      apply_aggregate_job: {
        Args: {
          p_aggregate_deltas: Json
          p_game_id: string
          p_job_id: string
          p_player_deltas: Json
        }
        Returns: string
      }
      batch_decrement_aggregates: {
        Args: { p_deltas: Json }
        Returns: undefined
      }
      batch_decrement_player_aggregates: {
        Args: { p_deltas: Json }
        Returns: undefined
      }
      batch_update_seeds: {
        Args: { p_seeds: Json; p_tournament_id: string }
        Returns: undefined
      }
      batch_upsert_aggregates: { Args: { p_deltas: Json }; Returns: undefined }
      batch_upsert_player_aggregates: {
        Args: { p_deltas: Json }
        Returns: undefined
      }
      bootstrap_first_admin: { Args: { p_player_id: string }; Returns: string }
      cancel_aggregate_jobs_for_game: {
        Args: { p_game_id: string }
        Returns: number
      }
      check_and_record_admin_export: {
        Args: { p_daily_limit?: number; p_player_id: string }
        Returns: Json
      }
      check_and_record_ai_generation: {
        Args: {
          p_daily_limit?: number
          p_endpoint: string
          p_player_id: string
        }
        Returns: Json
      }
      check_and_record_avatar_generation: {
        Args: { p_daily_limit: number; p_player_id: string }
        Returns: Json
      }
      claim_aggregate_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          game_id: string
          id: string
          last_error: string | null
          max_attempts: number
          operation: string
          processed_at: string | null
          season_id: string | null
          status: string
          tournament_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "aggregate_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_game_edit_lease: {
        Args: {
          p_expected_updated_at: string
          p_game_id: string
          p_token: string
          p_ttl_seconds: number
        }
        Returns: string
      }
      claim_guest_player: {
        Args: { p_guest_id: string; p_source_id: string }
        Returns: {
          auth_user_id: string | null
          avatar_config: Json | null
          avatar_url: string | null
          ban_reason: string | null
          champions_username: string
          created_at: string
          discord_id: string | null
          id: string
          is_admin: boolean
          is_creator: boolean
          is_guest: boolean
          is_test_account: boolean
          joined_date: string
          name: string
          ps_username: string
          sprite_style: string
          status: string
          suspended_until: string | null
          updated_at: string
          world_experience: string
        }
        SetofOptions: {
          from: "*"
          to: "players"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      draft__activate_next: {
        Args: { p_at: string; p_pool_id: string }
        Returns: string
      }
      draft__add_running_ms: {
        Args: {
          p_end: number
          p_from: string
          p_ms: number
          p_start: number
          p_tz: string
        }
        Returns: string
      }
      draft__build_snapshot: {
        Args: { p_pool: Database["public"]["Tables"]["draft_pools"]["Row"] }
        Returns: Json
      }
      draft__cfg_bool: {
        Args: { p_cfg: Json; p_key: string }
        Returns: boolean
      }
      draft__cfg_int: {
        Args: {
          p_cfg: Json
          p_key: string
          p_max: number
          p_min: number
          p_nullable?: boolean
        }
        Returns: number
      }
      draft__cfg_ladder: { Args: { p_cfg: Json }; Returns: number[] }
      draft__cfg_quiet: {
        Args: { p_cfg: Json }
        Returns: Record<string, unknown>
      }
      draft__cfg_ts: { Args: { p_cfg: Json; p_key: string }; Returns: string }
      draft__commit_pick: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_role: string
          p_client_request_id: string
          p_entry_id: string
          p_line_thresholds: Json
          p_pool: Database["public"]["Tables"]["draft_pools"]["Row"]
          p_reason: string
          p_redraft_slot_id: string
          p_slot: Database["public"]["Tables"]["draft_slots"]["Row"]
        }
        Returns: Json
      }
      draft__completable_search: {
        Args: {
          p_budget: number[]
          p_elig: boolean[]
          p_line: string[]
          p_node_limit?: number
          p_price: number[]
          p_slots: number[]
        }
        Returns: Json
      }
      draft__legal_lines: {
        Args: { p_player_id: string; p_pool_id: string }
        Returns: {
          entry_id: string
          line_id: string
          price: number
        }[]
      }
      draft__lock: {
        Args: { p_pool_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          default_point_cost: number | null
          draft_type: Database["public"]["Enums"]["draft_type"]
          ended_at: string | null
          engine: string
          extension_seconds: number[]
          extensions_enabled: boolean
          id: string
          kind: string
          list_version_id: string | null
          makeup_seconds: number | null
          mode: string
          parent_pool_id: string | null
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          phase: string
          pick_order: string
          pick_seconds: number | null
          point_budget: number | null
          pool_mode: string
          publish_notified_at: string | null
          publish_refused_at: string | null
          publish_refused_version: number | null
          quiet_end_hour: number | null
          quiet_start_hour: number | null
          quiet_timezone: string | null
          redraft_lock_no_redraft_lines: boolean
          redraft_max_lines: number | null
          roster_size: number | null
          season_group_id: string | null
          season_id: string
          slow_ladder_seconds: number[]
          started_at: string | null
          state_version: number
          status: Database["public"]["Enums"]["draft_pool_status"]
          submission_deadline_at: string | null
          submissions_published_at: string | null
          team_size_exact: number | null
          team_size_max: number | null
          team_size_min: number | null
          team_size_mode: string | null
          token_purchase_closes_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "draft_pools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      draft__log: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_role: string
          p_after?: Json
          p_before?: Json
          p_client_request_id?: string
          p_is_public?: boolean
          p_line_id?: string
          p_pick_id?: string
          p_player_id?: string
          p_pool_id: string
          p_reason?: string
          p_season_id: string
          p_slot_id?: string
        }
        Returns: undefined
      }
      draft__min_completion: {
        Args: {
          p_exclude_line: string
          p_player_id: string
          p_pool_id: string
          p_slots: number
        }
        Returns: {
          cnt: number
          cost: number
        }[]
      }
      draft__open_slots: {
        Args: { p_player_id: string; p_pool_id: string }
        Returns: number
      }
      draft__player_group: {
        Args: { p_player_id: string; p_season_id: string }
        Returns: string
      }
      draft__pool_completable: { Args: { p_pool_id: string }; Returns: Json }
      draft__publish_retry_due: {
        Args: { p_pool: Database["public"]["Tables"]["draft_pools"]["Row"] }
        Returns: boolean
      }
      draft__quiet_bounds: {
        Args: { p_day: string; p_end: number; p_start: number; p_tz: string }
        Returns: Record<string, unknown>
      }
      draft__quiet_hours_json: {
        Args: { p_end: number; p_start: number; p_tz: string }
        Returns: Json
      }
      draft__quiet_next_start: {
        Args: { p_at: string; p_end: number; p_start: number; p_tz: string }
        Returns: string
      }
      draft__quiet_window_end: {
        Args: { p_at: string; p_end: number; p_start: number; p_tz: string }
        Returns: string
      }
      draft__remaining_budget: {
        Args: { p_player_id: string; p_pool_id: string }
        Returns: number
      }
      draft__resolve_timeouts: { Args: { p_pool_id: string }; Returns: number }
      draft__resume: { Args: { p_pool_id: string }; Returns: number }
      draft__running_ms: {
        Args: {
          p_end: number
          p_from: string
          p_start: number
          p_to: string
          p_tz: string
        }
        Returns: number
      }
      draft__slot_seconds: {
        Args: {
          p_kind: string
          p_player_id: string
          p_pool: Database["public"]["Tables"]["draft_pools"]["Row"]
        }
        Returns: number
      }
      draft__tick: { Args: { p_pool_id: string }; Returns: Json }
      draft__validate_seats: { Args: { p_seats: Json }; Returns: number }
      draft_admin_set_penalty: {
        Args: {
          p_actor_id: string
          p_player_id: string
          p_pool_id: string
          p_reason: string
          p_stage: number
        }
        Returns: Json
      }
      draft_admin_void_pick: {
        Args: {
          p_actor_id: string
          p_client_request_id?: string
          p_pick_id: string
          p_pool_id: string
          p_reason: string
          p_replacement_line_id?: string
          p_replacement_thresholds?: Json
          p_requeue: boolean
        }
        Returns: Json
      }
      draft_claim_notifications: { Args: { p_pool_id?: string }; Returns: Json }
      draft_configure: {
        Args: {
          p_actor_id: string
          p_patch: Json
          p_pool_id: string
          p_seats?: Json
        }
        Returns: Json
      }
      draft_confirm_pick: {
        Args: {
          p_actor_id: string
          p_actor_role: string
          p_client_request_id: string
          p_line_id: string
          p_line_thresholds?: Json
          p_override_reason?: string
          p_player_id: string
          p_pool_id: string
          p_redraft_slot_id?: string
          p_slot_id: string
        }
        Returns: Json
      }
      draft_create_pool: {
        Args: {
          p_actor_id: string
          p_config: Json
          p_kind: string
          p_season_group_id?: string
          p_season_id: string
          p_seats: Json
        }
        Returns: string
      }
      draft_end: {
        Args: { p_actor_id: string; p_pool_id: string; p_reason: string }
        Returns: Json
      }
      draft_my_turn: {
        Args: { p_player_id: string; p_pool_id: string }
        Returns: Json
      }
      draft_set_paused: {
        Args: {
          p_actor_id: string
          p_paused: boolean
          p_pool_id: string
          p_reason: string
        }
        Returns: Json
      }
      draft_snapshot: {
        Args: { p_pool_id: string; p_since?: number; p_tick?: boolean }
        Returns: Json
      }
      draft_start: {
        Args: { p_actor_id: string; p_pool_id: string }
        Returns: Json
      }
      draft_tick: { Args: { p_pool_id: string }; Returns: Json }
      draft_use_extension: {
        Args: {
          p_kind: string
          p_player_id: string
          p_pool_id: string
          p_slot_id: string
        }
        Returns: Json
      }
      epb__lock_kill_credit_epoch: {
        Args: { p_season_id: string }
        Returns: number
      }
      epb__season_remaining_points: {
        Args: { p_player_id: string; p_season_id: string }
        Returns: number
      }
      epb_apply_progress: {
        Args: {
          p_amount: number
          p_created_by?: string
          p_matchday?: number
          p_note?: string
          p_source: string
          p_tracker_id: string
        }
        Returns: {
          base_pokemon: string
          cosmo_points: number
          created_at: string
          current_form: string
          current_stage: number
          draft_tokens: number
          evolution_points_awarded: number
          evolved_at: string | null
          id: string
          kill_tokens: number
          line_id: string | null
          locked_stage3_pokemon: string | null
          player_id: string
          real_kills: number
          redraft_slot_id: string | null
          season_group_id: string | null
          season_id: string
          suspended_until_matchday: number | null
          total_kos: number
          transferred_evo_progress: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "evolution_tracker"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      epb_credit_game_kills: {
        Args: { p_credits: Json; p_game_id: string }
        Returns: string
      }
      epb_fold_id: { Args: { p_name: string }; Returns: string }
      epb_grant_and_apply_tokens: {
        Args: {
          p_allocations: Json
          p_created_by?: string
          p_grant_type: string
          p_player_id: string
          p_season_id: string
        }
        Returns: undefined
      }
      epb_kill_credit_epoch: { Args: { p_season_id: string }; Returns: number }
      epb_line_id: {
        Args: { p_base: string; p_stage2: string; p_stage3: string }
        Returns: string
      }
      epb_purchase_draft_token: {
        Args: {
          p_actor_id: string
          p_client_request_id: string
          p_line_id: string
          p_next_threshold: number
          p_player_id: string
          p_season_id: string
          p_tokens_per_progress?: number
        }
        Returns: Json
      }
      epb_recalculate_evolution_points: {
        Args: { p_season_id: string }
        Returns: Json
      }
      epb_replace_match_snapshots: {
        Args: { p_match_id: string; p_snapshots: Json }
        Returns: undefined
      }
      epb_set_comeback_spend_open: {
        Args: { p_actor_id: string; p_open: boolean; p_season_id: string }
        Returns: undefined
      }
      epb_set_redraft_phase_open: {
        Args: { p_open: boolean; p_season_id: string }
        Returns: Json
      }
      epb_spend_comeback_tokens: {
        Args: {
          p_actor_id: string
          p_allocations: Json
          p_client_request_id: string
          p_earned_total: number
          p_player_id: string
          p_season_id: string
        }
        Returns: Json
      }
      epb_sync_game_kill_credit: {
        Args: {
          p_credited_match_ids: string[]
          p_expected_epoch: number
          p_game_credits: Json
          p_season_id: string
        }
        Returns: Json
      }
      epb_uncredit_game_kills: {
        Args: {
          p_debits: Json
          p_expected_applied_at: string
          p_game_id: string
        }
        Returns: string
      }
      format_attach_season: {
        Args: {
          p_definition_id: string
          p_preset_rulesets?: Json
          p_season_id: string
          p_seed: string
          p_spec: Json
          p_spec_hash: string
          p_stages: Json
          p_version_no: number
        }
        Returns: Json
      }
      format_delete_unused_preset_rulesets: {
        Args: { p_kept: Json; p_recorded: Json }
        Returns: string[]
      }
      format_detach_season: { Args: { p_season_id: string }; Returns: Json }
      format_publish_version: {
        Args: {
          p_actor: string
          p_changelog: Json
          p_content_hash: string
          p_definition_id: string
          p_expected_rev: number
          p_schema_version: number
          p_spec: Json
        }
        Returns: {
          out_version_id: string
          out_version_no: number
        }[]
      }
      format_season_started: { Args: { p_season_id: string }; Returns: boolean }
      get_item_usage_for_pokemon: {
        Args: {
          p_limit?: number
          p_player_id?: string
          p_scope_id?: string
          p_scope_type: Database["public"]["Enums"]["aggregate_scope"]
          p_species: string
        }
        Returns: {
          item: string
          total_sets: number
          uses: number
        }[]
      }
      get_total_games_in_scope: {
        Args: {
          p_scope_id: string
          p_scope_type: Database["public"]["Enums"]["aggregate_scope"]
        }
        Returns: number
      }
      increment_evolution_points: {
        Args: { p_amount?: number; p_tracker_id: string }
        Returns: undefined
      }
      increment_tracker_progress: {
        Args: { p_amount: number; p_source: string; p_tracker_id: string }
        Returns: {
          base_pokemon: string
          cosmo_points: number
          created_at: string
          current_form: string
          current_stage: number
          draft_tokens: number
          evolution_points_awarded: number
          evolved_at: string | null
          id: string
          kill_tokens: number
          line_id: string | null
          locked_stage3_pokemon: string | null
          player_id: string
          real_kills: number
          redraft_slot_id: string | null
          season_group_id: string | null
          season_id: string
          suspended_until_matchday: number | null
          total_kos: number
          transferred_evo_progress: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "evolution_tracker"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      league_trash__archive_tables: { Args: never; Returns: string[] }
      league_trash__assert_inventory: { Args: never; Returns: undefined }
      league_trash__capture: {
        Args: { p_season: string; p_trash: string }
        Returns: Json
      }
      league_trash__external_parents: {
        Args: never
        Returns: {
          jcol: string
          junction: string
          parent: string
          protection: string
        }[]
      }
      league_trash__insert_archive_rows: {
        Args: { p_step: number; p_trash_id: string }
        Returns: number
      }
      league_trash__insert_rows: {
        Args: {
          p_defer: string[]
          p_filter: string
          p_rel: string
          p_rows: Json
          p_snapshot_cols: Json
        }
        Returns: number
      }
      league_trash__inventory: {
        Args: never
        Returns: {
          cls: string
          pred: string
          rel: string
        }[]
      }
      league_trash__pointers: {
        Args: never
        Returns: {
          col: string
          parent: string
          pred: string
          rel: string
          relink: boolean
        }[]
      }
      league_trash__protect: { Args: { p_trash: string }; Returns: undefined }
      league_trash__restore_plan: {
        Args: never
        Returns: {
          defer: string[]
          filter: string
          rel: string
          step: number
        }[]
      }
      league_trash__shift: {
        Args: { p_rel: string; p_row: Json; p_shift: string }
        Returns: Json
      }
      league_trash__shift_col: {
        Args: { p_col: string; p_row: Json; p_shift: string }
        Returns: Json
      }
      league_trash__x: { Args: { p_pred: string }; Returns: string }
      league_trash_delete: {
        Args: { p_actor: string; p_retention_days: number; p_season_id: string }
        Returns: Json
      }
      league_trash_expire: {
        Args: { p_limit?: number; p_now?: string }
        Returns: Json
      }
      league_trash_rebuild_done: {
        Args: { p_trash_id: string }
        Returns: boolean
      }
      league_trash_restore: {
        Args: { p_now?: string; p_trash_id: string }
        Returns: Json
      }
      league_trash_restore_rebuild_done: {
        Args: { p_season_id: string }
        Returns: boolean
      }
      league_trash_schema_version: { Args: never; Returns: string }
      match_in_test_season: { Args: { p_match_id: string }; Returns: boolean }
      merge_move_counts: {
        Args: { existing: Json; incoming: Json }
        Returns: Json
      }
      rate_limit_hit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          hits: number
          retry_after_seconds: number
        }[]
      }
      rating_apply_match_result: {
        Args: { p_match_id: string; p_players: Json }
        Returns: string
      }
      rating_replace_player_history: {
        Args: {
          p_expected_history_match_ids?: string[]
          p_history: Json
          p_player_id: string
          p_state: Json
        }
        Returns: number
      }
      reclaim_stale_aggregate_jobs: { Args: never; Returns: number }
      redraft__publish_locked: {
        Args: {
          p_actor_id: string
          p_actor_role: string
          p_pool: Database["public"]["Tables"]["draft_pools"]["Row"]
          p_reason: string
        }
        Returns: Json
      }
      redraft_admin_restore_drop: {
        Args: {
          p_actor_id: string
          p_pool_id: string
          p_reason: string
          p_redraft_slot_id: string
        }
        Returns: Json
      }
      redraft_publish: {
        Args: {
          p_actor_id: string
          p_force: boolean
          p_pool_id: string
          p_reason: string
        }
        Returns: Json
      }
      redraft_set_submission: {
        Args: {
          p_actor_id: string
          p_actor_role: string
          p_line_ids: string[]
          p_player_id: string
          p_pool_id: string
        }
        Returns: Json
      }
      release_game_edit_lease: {
        Args: { p_game_id: string; p_token: string }
        Returns: boolean
      }
      rollback_game_aggregates: {
        Args: {
          p_aggregate_deltas: Json
          p_expected_applied_at: string
          p_game_id: string
          p_player_deltas: Json
        }
        Returns: string
      }
      ruleset_fold_ids: { Args: { p_names: string[] }; Returns: string[] }
      ruleset_publish_version: {
        Args: {
          p_actor: string
          p_catalog_version: string
          p_changelog: Json
          p_content_hash: string
          p_definition_id: string
          p_expected_rev: number
          p_format_key: string
          p_gen: number
          p_is_doubles: boolean
          p_resolved: Json
          p_resolved_hash: string
          p_schema_version: number
          p_spec: Json
        }
        Returns: {
          out_version_id: string
          out_version_no: number
        }[]
      }
      season_group__has_live_pool: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      season_group__league_scheduled: {
        Args: { p_season_id: string }
        Returns: boolean
      }
      season_groups_replace: {
        Args: { p_groups: Json; p_season_id: string }
        Returns: Json
      }
      season_participant_remove: {
        Args: { p_player_id: string; p_season_id: string }
        Returns: boolean
      }
      subtract_move_counts: {
        Args: { existing: Json; removed: Json }
        Returns: Json
      }
      team_correct_delete: { Args: { p_team_id: string }; Returns: boolean }
      team_correct_update: {
        Args: {
          p_import_source: Database["public"]["Enums"]["team_import_source"]
          p_name?: string
          p_pokemon: Json
          p_team_id: string
        }
        Returns: boolean
      }
      upsert_aggregate: {
        Args: {
          p_appearances: number
          p_brought: number
          p_games: number
          p_koed: number
          p_kos_dealt: number
          p_led: number
          p_move_counts: Json
          p_pokemon_name: string
          p_scope_id: string
          p_scope_type: Database["public"]["Enums"]["aggregate_scope"]
          p_wins: number
        }
        Returns: undefined
      }
      upsert_player_aggregate: {
        Args: {
          p_appearances: number
          p_brought: number
          p_games: number
          p_koed: number
          p_kos_dealt: number
          p_led: number
          p_move_counts: Json
          p_player_id: string
          p_pokemon_name: string
          p_scope_id: string
          p_scope_type: Database["public"]["Enums"]["aggregate_scope"]
          p_wins: number
        }
        Returns: undefined
      }
    }
    Enums: {
      aggregate_scope: "tournament" | "league" | "all_time"
      bracket_type: "single_elim" | "double_elim" | "round_robin" | "swiss"
      draft_pool_status: "pending" | "in_progress" | "complete"
      draft_type: "snake" | "auction" | "budget"
      game_source: "ps_replay" | "manual" | "champions"
      match_proposal_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "expired"
        | "cancelled"
      match_status:
        | "scheduled"
        | "in_progress"
        | "pending_confirmation"
        | "completed"
        | "disputed"
      round_status: "pending" | "active" | "completed"
      season_format_type:
        | "singles"
        | "doubles"
        | "draft"
        | "evolution_point_buy"
        | "custom"
      season_status: "upcoming" | "active" | "completed"
      team_import_source: "pokepastes" | "manual" | "ps_text"
      team_visibility: "hidden_until_match" | "always_public"
      tournament_status: "upcoming" | "active" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      aggregate_scope: ["tournament", "league", "all_time"],
      bracket_type: ["single_elim", "double_elim", "round_robin", "swiss"],
      draft_pool_status: ["pending", "in_progress", "complete"],
      draft_type: ["snake", "auction", "budget"],
      game_source: ["ps_replay", "manual", "champions"],
      match_proposal_status: [
        "pending",
        "accepted",
        "rejected",
        "expired",
        "cancelled",
      ],
      match_status: [
        "scheduled",
        "in_progress",
        "pending_confirmation",
        "completed",
        "disputed",
      ],
      round_status: ["pending", "active", "completed"],
      season_format_type: [
        "singles",
        "doubles",
        "draft",
        "evolution_point_buy",
        "custom",
      ],
      season_status: ["upcoming", "active", "completed"],
      team_import_source: ["pokepastes", "manual", "ps_text"],
      team_visibility: ["hidden_until_match", "always_public"],
      tournament_status: ["upcoming", "active", "completed"],
    },
  },
} as const

