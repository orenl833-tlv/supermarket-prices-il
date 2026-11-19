-- A chain's online store (Shufersal ONLINE, Rami Levy's internet warehouse)
-- is published as a branch of its own, with its own prices and no street
-- address. It is not a place to walk to: it is used only to compare home
-- delivery, never in the walking comparison or the map.
ALTER TABLE stores ADD COLUMN online BOOLEAN NOT NULL DEFAULT false;
