// ============================================================
// Database type definitions — matches 001_initial_schema.sql
// ============================================================

export type PlanTier = "front" | "premium";
export type FormatType = "story" | "talking_head" | "carousel" | "image_post";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";
export type ProductType = "front" | "premium" | "lead_magnet";

// ---- Row types ----

export interface BrandStyle {
  // Text
  font_name: string;
  font_size_px: number;
  font_weight: "bold" | "light" | "regular" | "extra-bold";
  text_color: string;
  text_position: "center" | "bottom-center" | "top" | "bottom-left" | "bottom-right" | "top-left" | "top-right";
  text_size: "large" | "medium" | "small";
  text_direction: "rtl" | "ltr";
  text_shadow: boolean;
  text_shadow_color?: string;
  line_height: number;
  letter_spacing: number;
  text_align: "center" | "right" | "left";
  avg_words_per_line: number;
  // Overlay
  overlay_style: "solid" | "gradient" | "semi-transparent" | "blur" | "none";
  overlay_opacity: number;
  overlay_color: string;
  overlay_gradient_direction?: string;
  overlay_gradient_from?: string;
  overlay_gradient_to?: string;
  // Text background (pill/box behind text, separate from image overlay)
  has_text_background: boolean;
  text_background_color?: string;
  text_background_opacity?: number;
  text_background_border_radius?: number;
  // Colors
  accent_color?: string;
  secondary_color?: string;
  // Recurring elements
  has_recurring_elements: boolean;
  recurring_elements_description?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  plan: PlanTier;
  brand_style: BrandStyle | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Idea {
  id: string;
  project_id: string;
  brief: string;
  expansion: string | null;
  created_at: string;
  updated_at: string;
}

export interface Hook {
  id: string;
  idea_id: string | null;
  user_id: string | null;
  hook_text: string;
  is_selected: boolean;
  is_used: boolean;
  display_order: number;
  status: GenerationStatus;
  created_at: string;
  updated_at: string;
}

export interface CorePost {
  id: string;
  hook_id: string | null;
  project_id: string | null;
  body: string;
  title: string | null;
  user_id: string | null;
  hook_text: string | null;
  user_response: string | null;
  status: GenerationStatus;
  created_at: string;
  updated_at: string;
}

export interface FormatVariant {
  id: string;
  core_post_id: string;
  format: FormatType;
  body: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface MediaAsset {
  id: string;
  format_variant_id: string;
  asset_type: string;
  url: string;
  provider: string | null;
  provider_ref_id: string | null;
  status: GenerationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CoreIdentity {
  id: string;
  user_id: string;
  who_i_am: string;
  who_i_serve: string;
  how_i_sound: string;
  slang_examples: string;
  what_i_never_do: string;
  product_name: string;
  niche: string;
  created_at: string;
  updated_at: string;
}

export interface AudienceIdentity {
  id: string;
  user_id: string;
  location: string;
  employment: string;
  education: string;
  income: string;
  behavioral: string;
  awareness_level: string;
  daily_pains: string;
  emotional_pains: string;
  unresolved_consequences: string;
  fears: string;
  failed_solutions: string;
  limiting_beliefs: string;
  myths: string;
  daily_desires: string;
  emotional_desires: string;
  small_wins: string;
  ideal_solution: string;
  bottom_line: string;
  cross_audience_quotes: string;
  ideal_solution_words: string;
  identity_statements: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  user_id: string;
  name: string;
  type: ProductType;
  created_at: string;
  updated_at: string;
}

export type UserMediaCategory = "font" | "element" | "cover" | "style_file" | "audience_file";

export interface UserMedia {
  id: string;
  user_id: string;
  category: UserMediaCategory;
  file_name: string;
  storage_path: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---- Insert types (omit server-generated fields) ----

export type UserInsert = Pick<User, "id" | "email"> &
  Partial<Pick<User, "full_name" | "avatar_url" | "plan">>;

export type ProjectInsert = Pick<Project, "user_id"> &
  Partial<Pick<Project, "title">>;

export type IdeaInsert = Pick<Idea, "project_id" | "brief"> &
  Partial<Pick<Idea, "expansion">>;

export type HookInsert = Pick<Hook, "hook_text" | "display_order"> &
  Partial<Pick<Hook, "idea_id" | "user_id" | "is_selected" | "is_used" | "status">>;

export type CorePostInsert = Pick<CorePost, "body"> &
  Partial<Pick<CorePost, "hook_id" | "project_id" | "title" | "user_id" | "hook_text" | "user_response" | "status">>;

export type FormatVariantInsert = Pick<FormatVariant, "core_post_id" | "format"> &
  Partial<Pick<FormatVariant, "body" | "is_edited">>;

export type MediaAssetInsert = Pick<MediaAsset, "format_variant_id" | "asset_type" | "url"> &
  Partial<Pick<MediaAsset, "provider" | "provider_ref_id" | "status" | "metadata">>;

export type ProductInsert = Pick<Product, "user_id" | "name" | "type">;

export type UserMediaInsert = Pick<UserMedia, "user_id" | "category" | "file_name" | "storage_path"> &
  Partial<Pick<UserMedia, "metadata">>;

export type CoreIdentityInsert = Pick<CoreIdentity, "user_id"> &
  Partial<Pick<CoreIdentity, "who_i_am" | "who_i_serve" | "how_i_sound" | "slang_examples" | "what_i_never_do" | "product_name" | "niche">>;

export type AudienceIdentityInsert = Pick<AudienceIdentity, "user_id"> &
  Partial<Omit<AudienceIdentity, "id" | "user_id" | "created_at" | "updated_at">>;

// ---- Update types ----

export type UserUpdate = Partial<Pick<User, "email" | "full_name" | "avatar_url" | "plan">>;
export type ProjectUpdate = Partial<Pick<Project, "title">>;
export type IdeaUpdate = Partial<Pick<Idea, "brief" | "expansion">>;
export type HookUpdate = Partial<Pick<Hook, "hook_text" | "is_selected" | "is_used" | "display_order" | "status">>;
export type CorePostUpdate = Partial<Pick<CorePost, "body" | "title" | "hook_text" | "user_response" | "status">>;
export type FormatVariantUpdate = Partial<Pick<FormatVariant, "body" | "is_edited">>;
export type MediaAssetUpdate = Partial<Pick<MediaAsset, "asset_type" | "url" | "provider" | "provider_ref_id" | "status" | "metadata">>;
export type CoreIdentityUpdate = Partial<Pick<CoreIdentity, "who_i_am" | "who_i_serve" | "how_i_sound" | "slang_examples" | "what_i_never_do" | "product_name" | "niche">>;
export type AudienceIdentityUpdate = Partial<Omit<AudienceIdentity, "id" | "user_id" | "created_at" | "updated_at">>;

// ---- Supabase Database type (for client generics) ----

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      projects: {
        Row: Project;
        Insert: ProjectInsert;
        Update: ProjectUpdate;
      };
      ideas: {
        Row: Idea;
        Insert: IdeaInsert;
        Update: IdeaUpdate;
      };
      hooks: {
        Row: Hook;
        Insert: HookInsert;
        Update: HookUpdate;
      };
      core_posts: {
        Row: CorePost;
        Insert: CorePostInsert;
        Update: CorePostUpdate;
      };
      format_variants: {
        Row: FormatVariant;
        Insert: FormatVariantInsert;
        Update: FormatVariantUpdate;
      };
      media_assets: {
        Row: MediaAsset;
        Insert: MediaAssetInsert;
        Update: MediaAssetUpdate;
      };
      products: {
        Row: Product;
        Insert: ProductInsert;
        Update: Partial<Pick<Product, "name" | "type">>;
      };
      core_identities: {
        Row: CoreIdentity;
        Insert: CoreIdentityInsert;
        Update: CoreIdentityUpdate;
      };
      audience_identities: {
        Row: AudienceIdentity;
        Insert: AudienceIdentityInsert;
        Update: AudienceIdentityUpdate;
      };
      user_media: {
        Row: UserMedia;
        Insert: UserMediaInsert;
        Update: never;
      };
    };
    Enums: {
      plan_tier: PlanTier;
      format_type: FormatType;
      generation_status: GenerationStatus;
    };
  };
}
