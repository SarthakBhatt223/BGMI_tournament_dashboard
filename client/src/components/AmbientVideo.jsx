import { useEffect, useRef, useState } from 'react';

// The video stays mounted for the whole life of /display, so it keeps playing underneath the
// leaderboard and MVP views and "back to ambient" is instant. It only loads a local file.
export default function AmbientVideo({ media }) {
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
    return (
      <div className="ambient-placeholder">
        <p>Ambient video not found</p>
        <p className="ambient-placeholder-hint">Place the MP4 at public/media/{videoUrl?.replace('/media/', '') ?? 'ambient.mp4'}</p>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      className="ambient-video"
      src={videoUrl}
      autoPlay
      loop
      muted
      playsInline
      onError={() => setFailed(true)}
    />
  );
}
