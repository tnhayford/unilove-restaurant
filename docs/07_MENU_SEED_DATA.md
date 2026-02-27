# Menu Seed Data (Current Source of Truth)

Last verified against code: 2026-02-12

This list mirrors `src/db/seedMenu.js` and is the authoritative seed dataset used by `npm run seed:menu`.

## Categories

- Shawarma
- Chips
- Salads
- Others
- Rice

## Shawarma

- Shawarma (Chicken + Vegetables + Sausage Only) - 35
- Shawarma (Chicken + Butter + Vegetables + Sausage) - 40
- Shawarma (Chicken + Cheese + Vegetables + Sausage) - 45
- Shawarma (Chicken + Cheese + Baked Beans + Vegetables + Sausage) - 50
- Shawarma (Chicken + Extra Cheese + Vegetables + Sausage) - 55
- Shawarma (Chicken + Extra Cheese + Baked Beans + Vegetables + Sausage) - 60
- Shawarma (Chicken + Baked Beans + French Fries + Vegetables + Sausage) - 65
- Shawarma (Chicken + Extra Cheese + French Fries + Vegetables + Sausage) - 70
- The Boss Shawarma (Chicken + Baked Beans + Extra Cheese + Butter + French Fries + Vegetables + Sausage + 1 Litre Coca Cola) - 100

## Chips

- Potato Chips & Grilled Chicken - 50
- Yam Chips & Grilled Chicken - 50
- Potato Chips & Fried Chicken - 45
- Yam Chips & Fried Chicken - 45
- Potato Chips & Chicken Wings - 55
- Yam Chips & Chicken Wings - 55

## Salads

- Chicken Salad - 40
- Tuna Salads - 45

## Others

- Plantain + Palava Sauce & Fish - 55
- Yam + Palava Sauce & Fish - 55
- Yam + Egg Stew & Fish - 50
- Plantain + Egg Stew & Fish - 50

## Rice

- Jollof & Fried Chicken - 55
- Jollof & Chicken & Red Plantain - 60
- Jollof & Grilled Chicken - 60
- Jollof & Fish - 65
- Jollof & Fish Sauce - 70
- Assorted Jollof - 75
- Fried Rice & Fried Chicken - 50
- Fried Rice & Chicken Wings - 55
- Fried Rice & Beef Sauce - 60
- Fried Rice & Fish - 60
- Fried Rice & Fish Sauce - 65
- Assorted Fried Rice - 70
- Fried Rice & Grilled Chicken - 55
- Plain Rice & Fried Chicken - 50
- Plain Rice & Grilled chicken - 50
- Plain Rice & Chicken Wings - 55
- Plain Rice & Beef Sauce - 60

## Seed Behavior

- Existing listed items are upserted/reactivated.
- Items absent from this list are marked inactive.
