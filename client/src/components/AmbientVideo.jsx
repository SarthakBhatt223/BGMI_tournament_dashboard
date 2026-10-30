import { useEffect, useRef, useState } from 'react';

// The video stays mounted for the whole life of /display and keeps playing while it is hidden
// (`visible` false, any mode other than ambient), so "back to ambient" is instant. It only loads a
// local file. Without a video, ambient mode shows the event title over the animated backdrop; that
// title is not rendered in other modes, so it can never show through a board.
export default function AmbientVideo({ media, title, subtitle, visible = true }) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const videoUrl = media?.ambientVideoUrl;
  const available = media?.ambientVideoAvailable === true && !failed;

  useEffect(() => {
    setFailed(false); // a new file may have been supplied since the last failure
  }, [videoUrl, media?.ambientVideoAvailable]);

  useEffect(() => {
    // Autoplay can be refused until the page has been interacted with; retry quietly.
    videoRef.current?.play().catch(() => {});
  }, [available, videoUrl]);

  if (!available) {
    if (!visible) return null;
    return (
      // Complete-looking fallback for the audience. The missing-file warning is on the admin dashboard.
      <div className="ambient-fallback">
        <span className="ambient-rule" aria-hidden="true" />
        {title && <div className="ambient-title">{title}</div>}
        {subtitle && <div className="ambient-subtitle">{subtitle}</div>}
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      className={`ambient-video${visible ? '' : ' is-hidden'}`}
      src={videoUrl}
      autoPlay
      loop
      muted
      playsInline
      onError={() => setFailed(true)}
    />
  );
}
