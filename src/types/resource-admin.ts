export type AdminResourceType = 'tournament' | 'season';

export interface ResourceAdmin {
  id: string;
  player_id: string;
  resource_type: AdminResourceType;
  resource_id: string;
  created_at: string;
}

export interface ResourceAdminWithPlayer extends ResourceAdmin {
  player_name: string;
}
