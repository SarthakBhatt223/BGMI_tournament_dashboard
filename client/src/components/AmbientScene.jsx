import AmbientVideo from './AmbientVideo.jsx';
import TacticalBackdrop from './TacticalBackdrop.jsx';

// The ambient layers. The animated V3 backdrop is mounted for the whole life of /display, so its
// motion never restarts on a mode change; it is also the static artwork shown until a video exists.
// The dedicated video slot is public/media/ambient.mp4 (AmbientVideo): looping, muted, autoplay,
// covering the full 16:9 screen. It only appears in ambient mode and stays loaded otherwise.
export default function AmbientScene({ media, title, subtitle, active }) {
  return (
    <>
      <TacticalBackdrop />
      <AmbientVideo media={media} title={title} subtitle={subtitle} visible={active} />
    </>
  );
}
