-- Club deals: promotions only for members of a chain's club (credit card,
-- app). NULL means every customer. The engine applies a club deal only for
-- chains the user says they are a member of, and otherwise reports what
-- membership would have saved.
ALTER TABLE store_promotions ADD COLUMN club_name TEXT;
