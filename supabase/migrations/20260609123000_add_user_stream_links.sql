ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stream_link text;

INSERT INTO users (steam_id, stream_link)
VALUES
  (76561198077185564, 'https://www.youtube.com/@MAKASHIstreams'),
  (76561198821488649, 'https://www.youtube.com/@mudi4893'),
  (76561198866902480, 'https://www.youtube.com/@ariukadota'),
  (76561198949446557, 'https://www.youtube.com/@Pain.dota2autochess'),
  (76561198293344973, 'https://kick.com/cadisdota'),
  (76561198258384820, 'https://kick.com/mio'),
  (76561198152703834, 'https://www.twitch.tv/el_clasic0'),
  (76561198370083873, 'https://www.twitch.tv/miguelxdd199'),
  (76561198210785345, 'https://www.twitch.tv/kentvhq'),
  (76561198061350860, 'https://www.twitch.tv/dracularulez'),
  (76561198083127138, 'https://www.twitch.tv/ivank94'),
  (76561199532323678, 'https://www.twitch.tv/quanmaidac'),
  (76561198026902925, 'https://www.twitch.tv/serbianbutchertv'),
  (76561198042558628, 'https://www.twitch.tv/murzikviskas'),
  (76561198054107234, 'https://www.twitch.tv/envy_chilling'),
  (76561198075526745, 'https://www.twitch.tv/freefarm_m'),
  (76561198149083676, 'https://www.twitch.tv/dielikezombie'),
  (76561198831833177, 'https://www.twitch.tv/blatnoi_'),
  (76561197970298548, 'https://www.twitch.tv/madjickez'),
  (76561198252405606, 'https://www.twitch.tv/crazyyypanda'),
  (76561198080422188, 'https://www.twitch.tv/hoovr121'),
  (76561198375019659, 'https://www.twitch.tv/mryahootv'),
  (76561199716203900, 'https://www.twitch.tv/dudu_dala'),
  (76561198087397435, 'https://www.twitch.tv/paulparadoxonlive'),
  (76561198327078303, 'https://www.twitch.tv/ashro1991'),
  (76561198032611647, 'https://www.twitch.tv/corekid94'),
  (76561198276517363, 'https://www.twitch.tv/apossum_'),
  (76561198015021337, 'https://www.twitch.tv/rondo_mandarin'),
  (76561198254014950, 'https://www.twitch.tv/tenevoi_059'),
  (76561198404719293, 'https://www.douyu.com/48261'),
  (76561198427074151, 'https://www.douyu.com/5532877'),
  (76561199817038972, 'https://www.douyu.com/774482'),
  (76561198878501758, 'https://www.douyu.com/2139747'),
  (76561198237138642, 'https://www.douyu.com/10970886'),
  (76561198100277066, 'https://www.douyu.com/10061156')
ON CONFLICT (steam_id) DO UPDATE
SET stream_link = EXCLUDED.stream_link;
