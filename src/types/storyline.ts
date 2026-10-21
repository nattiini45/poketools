export interface Storyline {
  id: string;
  season_id: string;
  title: string;
  body: string;
  tags: string[];
  featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StorylineInsert {
  season_id: string;
  title: string;
  body: string;
  tags?: string[];
  featured?: boolean;
}

export interface StorylineUpdate {
  title?: string;
  body?: string;
  tags?: string[];
  featured?: boolean;
}
