import React from 'react';

// Light that travels around the parent's border. Parent must be position:relative.
// Pure CSS (offset-path), colors default to the active theme's accent.
export default function BorderBeam({size = 180, duration = 6, delay = 0, borderWidth = 2, reverse = false, colorFrom, colorTo}) {
  const style = {
    '--beam-size': `${size}px`,
    '--beam-duration': `${duration}s`,
    // A negative delay makes the beam start mid-lap instead of waiting.
    '--beam-delay': `${-delay}s`,
    '--beam-width': `${borderWidth}px`,
    ...(colorFrom ? {'--beam-from': colorFrom} : null),
    ...(colorTo ? {'--beam-to': colorTo} : null),
  };
  return <span className={reverse ? 'border-beam is-reverse' : 'border-beam'} style={style} aria-hidden="true">
    <span className="border-beam-light"/>
  </span>;
}
