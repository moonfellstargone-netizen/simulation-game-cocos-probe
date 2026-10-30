(() => {
  const frame = document.getElementById('GameDiv');
  if (!frame) throw new Error('ERR_COCOS_PROBE_FRAME_MISSING');

  // Creator's desktop SubFrame mode detects explicit frame-size changes.
  // Register before engine startup so its resize handler sees the new size.
  const fitFrame = () => {
    frame.style.width = `${window.innerWidth}px`;
    frame.style.height = `${window.innerHeight}px`;
  };
  fitFrame();
  window.addEventListener('resize', fitFrame);
})();
