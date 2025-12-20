-- Family domain core tables and triggers.

CREATE TABLE public.families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name text NOT NULL,
    color text CHECK (color ~ '^#(?:[0-9a-fA-F]{3}){1,6}$'),
    image_file_hash text,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE public.invite_codes (
    code text PRIMARY KEY,
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    generated_by_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    redeemed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    redeemed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tr_families_set_updated_at
BEFORE UPDATE ON public.families
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_members_set_updated_at
BEFORE UPDATE ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_invite_codes_set_updated_at
BEFORE UPDATE ON public.invite_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for finding user's member records efficiently
CREATE INDEX idx_members_user_id ON public.members(user_id) WHERE user_id IS NOT NULL;

