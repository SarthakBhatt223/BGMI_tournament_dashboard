import { useFirstLoadableImage } from '../hooks/useFirstLoadableImage.js';
import { playerInitials } from '../utils/formatters.js';

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const ARTWORK_URLS = ['/media/mvp-character.png', '/media/mvp-character.webp'];

// The MVP artwork holder: a fixed-size frame (aspect 17:27, shown at 34vh x 54vh) in the MVP
// composition. Whatever image it receives is scaled to FILL the frame and cropped to the frame
// (object-fit: cover, anchored to the top), so a portrait image with the same 17:27 aspect is never
// cropped. Recommended artwork size: 1020 x 1620 px (PNG or WebP, transparent background allowed).
//
// What it shows, in order of preference:
//   1. A real player photo: public/media/players/<playerId>.jpg (or .jpeg, .png, .webp).
//   2. The MVP artwork: public/media/mvp-character.png (or .webp). Replace the file to change it.
//   3. A clean tactical placeholder showing the player's initials when neither file exists.
// Nothing is ever generated: no fake photo, no invented figure. The artwork is decorative; the
// player's name, team and finishes are rendered as text beside it.
export function MvpPortraitFrame({ photo, artwork, name }) {
  return (
    <div className={`mvp-portrait${photo || artwork ? '' : ' mvp-portrait-empty'}`}>
      {photo ? (
        <img className="mvp-image" src={photo} alt={name} />
      ) : artwork ? (
        <img className="mvp-image" src={artwork} alt="" aria-hidden="true" />
      ) : (
        <span className="mvp-initials" aria-hidden="true">{playerInitials(name)}</span>
      )}
      <span className="mvp-sweep" aria-hidden="true" />
    </div>
  );
}

export default function MvpPortrait({ playerId, name }) {
  const photo = useFirstLoadableImage(playerId == null ? [] : PHOTO_EXTENSIONS.map((ext) => `/media/players/${playerId}.${ext}`));
  const artwork = useFirstLoadableImage(ARTWORK_URLS);
  return <MvpPortraitFrame photo={photo} artwork={artwork} name={name} />;
}
