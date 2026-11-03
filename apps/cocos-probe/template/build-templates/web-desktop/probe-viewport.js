(() => {
  const frame = document.getElementById('GameDiv');
  if (!frame) throw new Error('ERR_COCOS_PROBE_FRAME_MISSING');

  // Creator's desktop SubFrame mode detects explicit frame-size changes.
  // Register before engine startup so its resize handler sees the new size.
  const fitFrame = () => {
    const viewport = window.visualViewport;
    frame.style.left = `${viewport?.offsetLeft ?? 0}px`;
    frame.style.top = `${viewport?.offsetTop ?? 0}px`;
    frame.style.width = `${Math.min(window.innerWidth, viewport?.width ?? window.innerWidth)}px`;
    frame.style.height = `${Math.min(window.innerHeight, viewport?.height ?? window.innerHeight)}px`;
  };
  fitFrame();
  window.addEventListener('resize', fitFrame);
  window.visualViewport?.addEventListener('resize', fitFrame);
  window.visualViewport?.addEventListener('scroll', fitFrame);
})();
