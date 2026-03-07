-- Change steam_id from text to bigint
ALTER TABLE games DROP CONSTRAINT fk_games_user;

ALTER TABLE games
    ALTER COLUMN user_id TYPE bigint USING user_id::bigint;

ALTER TABLE users
    ALTER COLUMN steam_id TYPE bigint USING steam_id::bigint;

ALTER TABLE games
    ADD CONSTRAINT fk_games_user
    FOREIGN KEY (user_id) REFERENCES users (steam_id);
