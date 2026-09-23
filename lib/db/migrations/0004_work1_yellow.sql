-- Account hues moved off the new blue accent: the old cyan default becomes yellow.
UPDATE "accounts" SET "color" = '#EDE95C' WHERE upper("color") = '#4FC3F7';
