-- Migration for Restaurant Test web app menu_items table
-- Run this in Supabase SQL Editor if menu_items does not have the expected columns.

-- 1. Ensure menu_items table exists with all columns the web app expects.
CREATE TABLE IF NOT EXISTS public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  category TEXT DEFAULT 'Other',
  available BOOLEAN DEFAULT true,
  image_url TEXT DEFAULT '',
  emoji TEXT DEFAULT '🍽️',
  is_trending BOOLEAN DEFAULT false,
  is_new BOOLEAN DEFAULT false,
  sauces JSONB DEFAULT '[]'::jsonb,
  addons JSONB DEFAULT '[]'::jsonb,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add missing columns safely if table already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='description') THEN ALTER TABLE public.menu_items ADD COLUMN description TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='category') THEN ALTER TABLE public.menu_items ADD COLUMN category TEXT DEFAULT 'Other'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='available') THEN ALTER TABLE public.menu_items ADD COLUMN available BOOLEAN DEFAULT true; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='image_url') THEN ALTER TABLE public.menu_items ADD COLUMN image_url TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='emoji') THEN ALTER TABLE public.menu_items ADD COLUMN emoji TEXT DEFAULT '🍽️'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='is_trending') THEN ALTER TABLE public.menu_items ADD COLUMN is_trending BOOLEAN DEFAULT false; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='is_new') THEN ALTER TABLE public.menu_items ADD COLUMN is_new BOOLEAN DEFAULT false; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='sauces') THEN ALTER TABLE public.menu_items ADD COLUMN sauces JSONB DEFAULT '[]'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='addons') THEN ALTER TABLE public.menu_items ADD COLUMN addons JSONB DEFAULT '[]'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='display_order') THEN ALTER TABLE public.menu_items ADD COLUMN display_order INTEGER DEFAULT 0; END IF;
END $$;

-- 3. Enable RLS and create policies.
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- Customers/public can read available items.
DROP POLICY IF EXISTS "Public can read available menu items" ON public.menu_items;
CREATE POLICY "Public can read available menu items" ON public.menu_items
  FOR SELECT USING (true);

-- Authenticated users (owner) can do everything.
DROP POLICY IF EXISTS "Authenticated users can manage menu items" ON public.menu_items;
CREATE POLICY "Authenticated users can manage menu items" ON public.menu_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Auto-update timestamp trigger.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS menu_items_updated_at ON public.menu_items;
CREATE TRIGGER menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Useful indexes.
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON public.menu_items(category);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON public.menu_items(available);
CREATE INDEX IF NOT EXISTS idx_menu_items_display_order ON public.menu_items(display_order);
