-- Seed demo menu items for Restaurant Test web app
-- Run this in Supabase SQL Editor after running setup_menu_items.sql.
-- This clears existing items and inserts a fresh demo menu.
-- NOTE: If your merchant_id differs from the demo value below, replace it before running.

DO $$
DECLARE
  demo_merchant_id UUID := '11111111-1111-1111-1111-111111111111'::UUID;
BEGIN
  -- Optional: create the demo merchant row if it doesn't exist (adjust table/columns if your schema differs).
  -- If you already have a merchants table from Clover sync, comment this block out and set demo_merchant_id to your real merchant id.
  INSERT INTO public.merchants (id, name)
  VALUES (demo_merchant_id, 'Demo Restaurant')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
EXCEPTION WHEN OTHERS THEN
  -- merchants table may not exist; ignore
  NULL;
END $$;

TRUNCATE TABLE public.menu_items RESTART IDENTITY;

INSERT INTO public.menu_items
  (merchant_id, merchant_name, name, description, price, category, available, image_url, emoji, is_trending, is_new, sauces, addons, display_order)
VALUES
  -- WINGS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Classic Buffalo Wings', 'Crispy fried wings tossed in our signature buffalo sauce. Served with celery and ranch.', 1099, 'Wings', true, '', '🍗', true, false, '["Buffalo","BBQ","Garlic Parmesan","Lemon Pepper","Honey Sriracha","Mild"]', '[{"name":"Extra Ranch","price":50},{"name":"Extra Celery","price":100},{"name":"Blue Cheese","price":50}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Honey BBQ Wings', 'Sweet and smoky BBQ glaze over crispy wings.', 1199, 'Wings', true, '', '🍯', false, false, '["Buffalo","BBQ","Garlic Parmesan","Lemon Pepper","Honey Sriracha"]', '[{"name":"Extra Ranch","price":50},{"name":"Extra Celery","price":100}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Garlic Parmesan Wings', 'Tossed in garlic butter and parmesan cheese.', 1199, 'Wings', true, '', '🧄', true, false, '["Buffalo","BBQ","Garlic Parmesan","Lemon Pepper"]', '[{"name":"Extra Ranch","price":50},{"name":"Extra Celery","price":100}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Wing Sampler (10 pc)', 'Mix of buffalo, BBQ, and garlic parmesan wings.', 1599, 'Wings', true, '', '🍗', false, true, '["Buffalo","BBQ","Garlic Parmesan"]', '[{"name":"Extra Ranch","price":50},{"name":"Extra Celery","price":100},{"name":"Side of Fries","price":299}]', 4),

  -- BURGERS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Classic Cheeseburger', 'Angus beef patty, American cheese, lettuce, tomato, pickles, and house sauce.', 1099, 'Burgers', true, '', '🍔', true, false, '[]', '[{"name":"Bacon","price":150},{"name":"Extra Patty","price":400},{"name":"Avocado","price":150},{"name":"Fried Egg","price":150}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Bacon BBQ Burger', 'Beef patty, crispy bacon, cheddar, onion rings, and smoky BBQ sauce.', 1299, 'Burgers', true, '', '🥓', false, false, '[]', '[{"name":"Extra Bacon","price":150},{"name":"Extra Patty","price":400},{"name":"Avocado","price":150}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Mushroom Swiss Burger', 'Sautéed mushrooms and melted Swiss cheese with garlic aioli.', 1199, 'Burgers', true, '', '🍄', false, false, '[]', '[{"name":"Extra Patty","price":400},{"name":"Grilled Onions","price":100}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Spicy Jalapeño Burger', 'Pepper jack cheese, fresh jalapeños, chipotle mayo, and crispy onions.', 1249, 'Burgers', true, '', '🌶️', false, true, '[]', '[{"name":"Extra Jalapeños","price":100},{"name":"Bacon","price":150}]', 4),

  -- SANDWICHES
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Crispy Chicken Sandwich', 'Buttermilk fried chicken, pickles, and honey mustard on a brioche bun.', 999, 'Sandwiches', true, '', '🐔', true, false, '[]', '[{"name":"Spicy Mayo","price":50},{"name":"Bacon","price":150},{"name":"Lettuce & Tomato","price":0}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Philly Cheesesteak', 'Thinly sliced steak, grilled onions, peppers, and melted provolone.', 1299, 'Sandwiches', true, '', '🥩', false, false, '[]', '[{"name":"Extra Cheese","price":100},{"name":"Mushrooms","price":100},{"name":"Hot Peppers","price":50}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Pulled Pork Sandwich', 'Slow-smoked pulled pork with tangy coleslaw on a toasted bun.', 1149, 'Sandwiches', true, '', '🐷', false, false, '[]', '[{"name":"Extra Slaw","price":100},{"name":"Pickles","price":0}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Grilled Fish Tacos', 'Two soft tacos with blackened fish, cabbage slaw, and cilantro lime crema.', 1049, 'Fish & Tacos', true, '', '🌮', true, false, '[]', '[{"name":"Extra Taco","price":450},{"name":"Pico de Gallo","price":100}]', 4),

  -- APPETIZERS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Loaded Nachos', 'Tortilla chips topped with cheese, jalapeños, black beans, pico, and sour cream.', 999, 'Appetizers', true, '', '🧀', true, false, '[]', '[{"name":"Ground Beef","price":200},{"name":"Guacamole","price":150},{"name":"Extra Cheese","price":100}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Mozzarella Sticks', 'Golden fried mozzarella with marinara sauce.', 799, 'Appetizers', true, '', '🧀', false, false, '[]', '[{"name":"Extra Marinara","price":50}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Fried Pickles', 'Crispy battered dill pickle chips with ranch.', 699, 'Appetizers', true, '', '🥒', false, false, '[]', '[{"name":"Extra Ranch","price":50}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Spinach Artichoke Dip', 'Creamy spinach and artichoke dip served with tortilla chips.', 899, 'Appetizers', true, '', '🥣', false, true, '[]', '[{"name":"Extra Chips","price":100}]', 4),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Onion Rings', 'Thick-cut battered onion rings served with chipotle ranch.', 699, 'Appetizers', true, '', '🧅', false, false, '[]', '[{"name":"Chipotle Ranch","price":50}]', 5),

  -- FISH & TACOS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Blackened Fish Plate', 'Blackened white fish, rice, and steamed vegetables with remoulade.', 1399, 'Fish & Tacos', true, '', '🐟', false, false, '[]', '[{"name":"Extra Remoulade","price":50},{"name":"Side Salad","price":250}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Shrimp Tacos (2)', 'Grilled shrimp, avocado, cabbage, and chipotle crema in flour tortillas.', 1199, 'Fish & Tacos', true, '', '🍤', true, false, '[]', '[{"name":"Extra Taco","price":500}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Baja Fish Tacos', 'Beer-battered fish, slaw, and baja sauce in soft corn tortillas.', 1099, 'Fish & Tacos', true, '', '🌮', false, true, '[]', '[{"name":"Extra Taco","price":450}]', 3),

  -- PLATES
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Chicken Tender Basket', 'Crispy chicken tenders with fries and honey mustard.', 1199, 'Plates', true, '', '🍗', true, false, '[]', '[{"name":"Extra Tender","price":350},{"name":"Side of Ranch","price":50}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Ribs & Fries Plate', 'Half rack of BBQ ribs with seasoned fries and coleslaw.', 1699, 'Plates', true, '', '🍖', false, false, '[]', '[{"name":"Extra BBQ Sauce","price":50},{"name":"Cornbread","price":150}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Grilled Chicken Plate', 'Marinated grilled chicken breast, rice, and steamed veggies.', 1349, 'Plates', true, '', '🍗', false, false, '[]', '[{"name":"Double Chicken","price":500},{"name":"Side Salad","price":250}]', 3),

  -- SALADS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'House Garden Salad', 'Mixed greens, tomatoes, cucumbers, carrots, and croutons.', 799, 'Salads', true, '', '🥗', false, false, '[]', '[{"name":"Grilled Chicken","price":400},{"name":"Shrimp","price":500},{"name":"Avocado","price":150}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Caesar Salad', 'Romaine, parmesan, croutons, and Caesar dressing.', 899, 'Salads', true, '', '🥬', false, false, '[]', '[{"name":"Grilled Chicken","price":400},{"name":"Bacon","price":150}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Southwest Chicken Salad', 'Grilled chicken, black beans, corn, avocado, tortilla strips, chipotle ranch.', 1299, 'Salads', true, '', '🥗', true, true, '[]', '[{"name":"Extra Chicken","price":400}]', 3),

  -- KIDS MEALS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Kids Chicken Tenders', '2 tenders with fries and a drink.', 699, 'Kids Meals', true, '', '🍗', false, false, '[]', '[{"name":"Extra Tender","price":250}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Kids Cheeseburger', 'Mini burger with cheese and fries plus a drink.', 699, 'Kids Meals', true, '', '🍔', false, false, '[]', '[{"name":"Apple Slices","price":0}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Kids Mac & Cheese', 'Creamy macaroni and cheese with a drink.', 599, 'Kids Meals', true, '', '🧀', false, false, '[]', '[{"name":"Chicken Bites","price":250}]', 3),

  -- DESSERTS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Chocolate Lava Cake', 'Warm chocolate cake with a molten center and vanilla ice cream.', 799, 'Desserts', true, '', '🍫', true, false, '[]', '[{"name":"Extra Ice Cream","price":150}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'New York Cheesecake', 'Classic cheesecake with strawberry topping.', 749, 'Desserts', true, '', '🍰', false, false, '[]', '[{"name":"Whipped Cream","price":50}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Churros with Chocolate', 'Cinnamon sugar churros served with warm chocolate dipping sauce.', 699, 'Desserts', true, '', '🥨', false, true, '[]', '[{"name":"Extra Chocolate","price":100}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Brownie Sundae', 'Fudge brownie topped with vanilla ice cream and whipped cream.', 849, 'Desserts', true, '', '🍨', false, false, '[]', '[{"name":"Extra Ice Cream","price":150}]', 4),

  -- DRINKS
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Fountain Drink', 'Your choice of Coke, Diet Coke, Sprite, Dr Pepper, or lemonade.', 299, 'Drinks', true, '', '🥤', false, false, '[]', '[{"name":"Large Size","price":100}]', 1),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Sweet Iced Tea', 'Freshly brewed sweet tea.', 299, 'Drinks', true, '', '🍵', false, false, '[]', '[{"name":"Large Size","price":100}]', 2),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Fresh Lemonade', 'Squeezed daily lemonade.', 349, 'Drinks', true, '', '🍋', true, false, '[]', '[{"name":"Large Size","price":100}]', 3),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Milkshake', 'Hand-spun vanilla, chocolate, or strawberry milkshake.', 599, 'Drinks', true, '', '🥤', true, true, '["Vanilla","Chocolate","Strawberry"]', '[{"name":"Whipped Cream","price":50}]', 4),
  ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'Bottled Water', '16.9 oz purified water.', 199, 'Drinks', true, '', '💧', false, false, '[]', '[]', 5);
