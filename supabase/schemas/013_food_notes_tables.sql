-- Food notes tables and triggers.

CREATE TABLE public.food_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid REFERENCES public.members(id) ON DELETE CASCADE,
    family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
    content jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT food_notes_scope_check CHECK (
        (member_id IS NOT NULL AND family_id IS NULL) OR
        (member_id IS NULL AND family_id IS NOT NULL)
    ),
    CONSTRAINT food_notes_unique_member UNIQUE (member_id),
    CONSTRAINT food_notes_unique_family UNIQUE (family_id)
);

CREATE TABLE public.food_notes_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    food_note_id uuid NOT NULL REFERENCES public.food_notes(id) ON DELETE CASCADE,
    content jsonb NOT NULL,
    version integer NOT NULL,
    changed_by_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for food_notes_history
CREATE INDEX idx_food_notes_history_note_id ON public.food_notes_history(food_note_id);
CREATE INDEX idx_food_notes_history_version ON public.food_notes_history(food_note_id, version DESC);

-- Trigger for updated_at
CREATE TRIGGER tr_food_notes_set_updated_at
BEFORE UPDATE ON public.food_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
