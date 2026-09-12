export function createLiveCallLimit() {
  let active = false;
  const times = [];
  return {
    acquire(now = Date.now()) {
      while (times.length && now - times[0] >= 60000) times.shift();
      if (active || times.length >= 6) return false;
      active = true;
      times.push(now);
      return true;
    },
    release() { active = false; }
  };
}
