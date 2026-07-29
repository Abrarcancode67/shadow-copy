(function(){
  "use strict";

  /* ============ Setup ============ */
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const gameWrap = document.getElementById('gameWrap');

  // Arena increased ~30% from original 800x600
  const ARENA_W = 1040, ARENA_H = 780;

  function resize(){
    canvas.width = ARENA_W;
    canvas.height = ARENA_H;
  }
  window.addEventListener('resize', resize);

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if(isTouch){ document.getElementById('touchControls').classList.add('active'); }

  /* ============ State ============ */
  const State = { MENU:'menu', TUTORIAL:'tutorial', SETTINGS:'settings', SCORES:'scores', PLAYING:'playing', PAUSED:'paused', OVER:'over' };
  let state = State.MENU;

  const settings = {
    sound: localStorage.getItem('sc_sound') !== 'off',
    shake: localStorage.getItem('sc_shake') !== 'off'
  };

  function getScores(){ try{ return JSON.parse(localStorage.getItem('sc_scores') || '[]'); }catch(e){ return []; } }
  function saveScore(s){
    const arr = getScores();
    arr.push({score:s, date: new Date().toLocaleDateString()});
    arr.sort((a,b)=>b.score-a.score);
    localStorage.setItem('sc_scores', JSON.stringify(arr.slice(0,10)));
  }
  function getBest(){ const arr = getScores(); return arr.length ? arr[0].score : 0; }

  /* ============ Audio ============ */
  let audioCtx = null;
  function ensureAudio(){ if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } }
  function beep(freq, dur, type, vol){
    if(!settings.sound || !audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type||'sine'; o.frequency.value = freq; g.gain.value = (vol!=null?vol:0.08);
    o.connect(g); g.connect(audioCtx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  }
  const sfx = {
    coin: ()=> beep(880, 0.12, 'triangle', 0.09),
    spawn: ()=> beep(180, 0.25, 'sawtooth', 0.06),
    tick: ()=> beep(520, 0.08, 'square', 0.05),
    death: ()=> { beep(140,0.35,'sawtooth',0.12); setTimeout(()=>beep(90,0.4,'sawtooth',0.1), 90); },
    levelUp: ()=> { beep(520,0.15,'square',0.07); setTimeout(()=>beep(680,0.18,'square',0.07), 120); },
    power: ()=> { beep(700,0.1,'sine',0.08); setTimeout(()=>beep(1000,0.14,'sine',0.08), 80); }
  };

  /* ============ Maze / Arena (scaled ~1.3x from original) ============ */
  function buildWalls(){
    const w = [];
    const t = 16;
    w.push({x:0,y:0,w:ARENA_W,h:t});
    w.push({x:0,y:ARENA_H-t,w:ARENA_W,h:t});
    w.push({x:0,y:0,w:t,h:ARENA_H});
    w.push({x:ARENA_W-t,y:0,w:t,h:ARENA_H});
    w.push({x:195,y:156,w:234,h:t});
    w.push({x:195,y:156,w:t,h:182});
    w.push({x:611,y:442,w:234,h:t});
    w.push({x:842,y:260,w:t,h:208});
    w.push({x:429,y:546,w:t,h:182});
    w.push({x:429,y:546,w:208,h:t});
    w.push({x:117,y:520,w:182,h:t});
    return w;
  }
  let walls = buildWalls();

  function circleRectCollide(cx,cy,r,rect){
    const nx = Math.max(rect.x, Math.min(cx, rect.x+rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y+rect.h));
    const dx = cx-nx, dy = cy-ny;
    return (dx*dx+dy*dy) < r*r;
  }

  /* ============ Config ============ */
  const PLAYER_R = 13;
  const CLONE_R = 13;
  const SAMPLE_MS = 100;
  const RECORD_WINDOW_MS = 5000;
  const SPAWN_INTERVAL_MS = 5000;
  const DIFFICULTY_INTERVAL_MS = 30000;
  const SPAWN_INVULN_MS = 1000;
  const TRAIL_LENGTH = 10;
  const POWERUP_INTERVAL_MS = 13000;
  const POWERUP_TYPES = ['shield','speed','magnet'];
  const GHOST_COLORS = [
    { fill:'rgba(177,140,255,0.65)', stroke:'rgba(210,190,255,0.6)', glow:'177,140,255' }, // purple
    { fill:'rgba(120,220,255,0.65)', stroke:'rgba(180,235,255,0.6)', glow:'120,220,255' }, // cyan
    { fill:'rgba(180,255,180,0.6)',  stroke:'rgba(210,255,210,0.55)', glow:'180,255,180' }, // mint
    { fill:'rgba(255,220,140,0.65)', stroke:'rgba(255,235,180,0.6)', glow:'255,220,140' }, // amber
    { fill:'rgba(255,150,220,0.6)',  stroke:'rgba(255,200,235,0.55)', glow:'255,150,220' }  // pink
  ];

  let player, clones, coins, movers, particles, powerups, activeEffects;
  let keys, joyVec;
  let elapsed, lastSpawnAt, lastDifficultyAt, difficultyMult, score, coinCount, clonesCreated;
  let recordBuffer;
  let invulnUntil;
  let shakeT, shakeMag;
  let animFrameId, lastTime;
  let lastPowerupAt;

  function resetGame(){
    player = { x: ARENA_W/2, y: ARENA_H/2, vx:0, vy:0, speed: 240 };
    clones = [];
    coins = [];
    particles = [];
    powerups = [];
    activeEffects = { shield:0, speed:0, magnet:0 };
    movers = [
      { x:520, y:325, r:15, ax:520, ay:325, bx:520, by:195, t:0, speed:0.6 },
      { x:325, y:624, r:15, ax:325, ay:624, bx:546, by:624, t:0, speed:0.5 },
      { x:780, y:156, r:15, ax:780, ay:156, bx:780, by:364, t:0, speed:0.7 }
    ];
    keys = { up:false, down:false, left:false, right:false };
    joyVec = { x:0, y:0 };
    elapsed = 0;
    lastSpawnAt = 0;
    lastDifficultyAt = 0;
    difficultyMult = 1;
    score = 0;
    coinCount = 0;
    clonesCreated = 0;
    recordBuffer = [];
    invulnUntil = 0;
    shakeT = 0; shakeMag = 0;
    lastPowerupAt = 0;
    spawnCoin(); spawnCoin(); spawnCoin(); spawnCoin();
    lastTime = performance.now();
  }

  function randomFreeSpot(margin){
    let tries = 0;
    while(tries < 60){
      const x = margin + Math.random()*(ARENA_W-margin*2);
      const y = margin + Math.random()*(ARENA_H-margin*2);
      let blocked = false;
      for(const w of walls){ if(circleRectCollide(x,y,margin, w)){ blocked = true; break; } }
      if(!blocked) return {x,y};
      tries++;
    }
    return {x: ARENA_W/2, y: ARENA_H/2};
  }

  function spawnCoin(){
    const p = randomFreeSpot(40);
    coins.push({x:p.x, y:p.y, r:8, spin:Math.random()*Math.PI*2});
  }

  function spawnPowerup(){
    const p = randomFreeSpot(40);
    const type = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
    powerups.push({x:p.x, y:p.y, r:11, type, bob:Math.random()*Math.PI*2});
  }

  function addParticles(x,y,color,count){
    for(let i=0;i<count;i++){
      const ang = Math.random()*Math.PI*2;
      const spd = 40 + Math.random()*120;
      particles.push({ x,y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 0.4+Math.random()*0.4, maxLife: 0.4+Math.random()*0.4, color });
    }
  }

  /* ============ Input ============ */
  window.addEventListener('keydown', (e)=>{
    if(state !== State.PLAYING) return;
    switch(e.code){
      case 'KeyW': case 'ArrowUp': keys.up=true; break;
      case 'KeyS': case 'ArrowDown': keys.down=true; break;
      case 'KeyA': case 'ArrowLeft': keys.left=true; break;
      case 'KeyD': case 'ArrowRight': keys.right=true; break;
      case 'Escape': togglePause(); break;
    }
  });
  window.addEventListener('keyup', (e)=>{
    switch(e.code){
      case 'KeyW': case 'ArrowUp': keys.up=false; break;
      case 'KeyS': case 'ArrowDown': keys.down=false; break;
      case 'KeyA': case 'ArrowLeft': keys.left=false; break;
      case 'KeyD': case 'ArrowRight': keys.right=false; break;
    }
  });

  const joyBase = document.getElementById('joyBase');
  const joyStick = document.getElementById('joyStick');
  let joyActive = false, joyId = null, joyCenter = {x:0,y:0};
  function joyStart(e){
    const t = e.changedTouches ? e.changedTouches[0] : e;
    joyId = t.identifier != null ? t.identifier : 'mouse';
    const rect = joyBase.getBoundingClientRect();
    joyCenter = {x: rect.left+rect.width/2, y: rect.top+rect.height/2};
    joyActive = true;
    joyMove(e);
  }
  function joyMove(e){
    if(!joyActive) return;
    let t = e.changedTouches ? Array.from(e.changedTouches).find(tt=>tt.identifier===joyId) : e;
    if(!t) return;
    let dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
    const max = 38;
    const dist = Math.min(Math.hypot(dx,dy), max);
    const ang = Math.atan2(dy,dx);
    const nx = Math.cos(ang)*dist, ny = Math.sin(ang)*dist;
    joyStick.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    joyVec.x = nx/max; joyVec.y = ny/max;
  }
  function joyEnd(){ joyActive = false; joyId = null; joyVec.x = 0; joyVec.y = 0; joyStick.style.transform = 'translate(-50%,-50%)'; }
  joyBase.addEventListener('touchstart', joyStart, {passive:true});
  joyBase.addEventListener('touchmove', joyMove, {passive:true});
  joyBase.addEventListener('touchend', joyEnd);
  joyBase.addEventListener('touchcancel', joyEnd);
  joyBase.addEventListener('mousedown', joyStart);
  window.addEventListener('mousemove', joyMove);
  window.addEventListener('mouseup', joyEnd);

  /* ============ Screen management ============ */
  const screens = {
    menu: document.getElementById('menuScreen'),
    tutorial: document.getElementById('tutorialScreen'),
    settings: document.getElementById('settingsScreen'),
    scores: document.getElementById('scoresScreen'),
    pause: document.getElementById('pauseScreen'),
    over: document.getElementById('gameOverScreen'),
  };
  const hud = document.getElementById('hud');

  function showOnly(name){
    Object.values(screens).forEach(s=>s.classList.add('hidden'));
    if(name && screens[name]) screens[name].classList.remove('hidden');
  }

  function goMenu(){
    state = State.MENU;
    showOnly('menu');
    hud.classList.add('hidden');
    if(animFrameId) cancelAnimationFrame(animFrameId);
  }

  function beginPlayFlow(){
    ensureAudio();
    if(localStorage.getItem('sc_seenTutorial') !== 'yes'){
      state = State.TUTORIAL;
      showOnly('tutorial');
    } else {
      startGame();
    }
  }

  function startGame(){
    ensureAudio();
    resetGame();
    state = State.PLAYING;
    showOnly(null);
    hud.classList.remove('hidden');
    document.getElementById('hudBest').textContent = getBest();
    if(animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(loop);
  }

  function togglePause(){
    if(state === State.PLAYING){ state = State.PAUSED; showOnly('pause'); }
    else if(state === State.PAUSED){ state = State.PLAYING; showOnly(null); lastTime = performance.now(); animFrameId = requestAnimationFrame(loop); }
  }

  function formatTime(ms){
    const total = Math.floor(ms/1000);
    const m = Math.floor(total/60);
    const s = total%60;
    return m + ':' + (s<10?'0':'') + s;
  }

  function gameOver(){
    state = State.OVER;
    sfx.death();
    triggerShake(14);
    const best = getBest();
    const isNew = score > best;
    saveScore(score);
    document.getElementById('statTime').textContent = formatTime(elapsed);
    document.getElementById('statClones').textContent = clonesCreated;
    document.getElementById('statScore').textContent = score;
    document.getElementById('statBest').textContent = Math.max(best, score);
    document.getElementById('newBestTag').classList.toggle('hidden', !isNew);
    setTimeout(()=> showOnly('over'), 220);
  }

  function triggerShake(mag){ if(!settings.shake) return; shakeT = 0.3; shakeMag = mag; }

  /* ============ Buttons ============ */
  document.getElementById('playBtn').onclick = beginPlayFlow;
  document.getElementById('howToBtn').onclick = ()=>{ showOnly('tutorial'); document.getElementById('tutorialContinueBtn').textContent = 'Back to Menu'; tutorialFromMenu = true; };
  document.getElementById('settingsBtn').onclick = ()=>{ showOnly('settings'); };
  document.getElementById('scoresBtn').onclick = ()=>{ renderScores(); showOnly('scores'); };
  document.getElementById('settingsBack').onclick = ()=>{ showOnly('menu'); };
  document.getElementById('scoresBack').onclick = ()=>{ showOnly('menu'); };
  document.getElementById('resumeBtn').onclick = togglePause;
  document.getElementById('quitBtn').onclick = goMenu;
  document.getElementById('retryBtn').onclick = startGame;
  document.getElementById('menuBtn').onclick = goMenu;
  document.getElementById('pauseBtn').onclick = togglePause;
  document.getElementById('pauseBtnMobile').onclick = togglePause;

  let tutorialFromMenu = false;
  document.getElementById('tutorialContinueBtn').onclick = ()=>{
    localStorage.setItem('sc_seenTutorial','yes');
    if(tutorialFromMenu){ tutorialFromMenu = false; document.getElementById('tutorialContinueBtn').textContent = "Got It, Let's Go"; goMenu(); }
    else { startGame(); }
  };

  const soundToggle = document.getElementById('soundToggle');
  const shakeToggle = document.getElementById('shakeToggle');
  soundToggle.classList.toggle('on', settings.sound);
  shakeToggle.classList.toggle('on', settings.shake);
  soundToggle.onclick = ()=>{ settings.sound = !settings.sound; soundToggle.classList.toggle('on', settings.sound); localStorage.setItem('sc_sound', settings.sound ? 'on':'off'); if(settings.sound) ensureAudio(); };
  shakeToggle.onclick = ()=>{ settings.shake = !settings.shake; shakeToggle.classList.toggle('on', settings.shake); localStorage.setItem('sc_shake', settings.shake ? 'on':'off'); };

  function renderScores(){
    const list = document.getElementById('scoreList');
    const arr = getScores();
    if(arr.length === 0){ list.innerHTML = '<div class="footNote">No scores yet — go survive something.</div>'; return; }
    list.innerHTML = arr.map((s,i)=>`<div class="scoreRow"><span>#${i+1} · ${s.date}</span><span>${s.score}</span></div>`).join('');
  }

  /* ============ Power-up HUD ============ */
  const POWER_META = {
    shield: {icon:'🟢', label:'Shield'},
    speed: {icon:'⚡', label:'Speed'},
    magnet: {icon:'🧲', label:'Magnet'}
  };
  function renderPowerupHud(){
    const wrap = document.getElementById('powerupHud');
    let html = '';
    for(const key of Object.keys(activeEffects)){
      if(activeEffects[key] > 0){
        const secs = Math.ceil(activeEffects[key]/1000);
        html += `<div class="powerupChip">${POWER_META[key].icon} ${secs}s</div>`;
      }
    }
    wrap.innerHTML = html;
  }

  /* ============ Game loop ============ */
  function loop(now){
    if(state !== State.PLAYING){ return; }
    let dt = (now - lastTime)/1000;
    dt = Math.min(dt, 0.05);
    lastTime = now;
    elapsed += dt*1000;

    update(dt, now);
    render(now);

    animFrameId = requestAnimationFrame(loop);
  }

  function update(dt, now){
    // effective speed with power-ups
    let curSpeed = player.speed * (activeEffects.speed > 0 ? 1.6 : 1);

    let ix = 0, iy = 0;
    if(keys.left) ix -= 1;
    if(keys.right) ix += 1;
    if(keys.up) iy -= 1;
    if(keys.down) iy += 1;
    if(joyVec.x || joyVec.y){ ix = joyVec.x; iy = joyVec.y; }
    const len = Math.hypot(ix,iy);
    if(len > 0){ ix/=len; iy/=len; }

    const nx = player.x + ix*curSpeed*dt;
    const ny = player.y + iy*curSpeed*dt;

    let px = player.x, py = player.y;
    let blockedX = walls.some(w=>circleRectCollide(nx, py, PLAYER_R, w));
    if(!blockedX) px = nx;
    let blockedY = walls.some(w=>circleRectCollide(px, ny, PLAYER_R, w));
    if(!blockedY) py = ny;
    player.x = Math.max(PLAYER_R+16, Math.min(ARENA_W-PLAYER_R-16, px));
    player.y = Math.max(PLAYER_R+16, Math.min(ARENA_H-PLAYER_R-16, py));

    // record buffer
    recordBuffer.push({t: elapsed, x: player.x, y: player.y});
    while(recordBuffer.length && elapsed - recordBuffer[0].t > RECORD_WINDOW_MS + 50){ recordBuffer.shift(); }

    // difficulty
    if(elapsed - lastDifficultyAt >= DIFFICULTY_INTERVAL_MS){
      lastDifficultyAt = elapsed;
      difficultyMult += 0.18;
      sfx.levelUp();
      triggerShake(6);
    }

    // spawn: instant and silent — no warning, no countdown
    if(elapsed - lastSpawnAt >= SPAWN_INTERVAL_MS && elapsed >= RECORD_WINDOW_MS){
      lastSpawnAt = elapsed;
      const track = recordBuffer.map(p => ({t: p.t - recordBuffer[0].t, x:p.x, y:p.y}));
      if(track.length > 1){
        const ghostColor = GHOST_COLORS[Math.floor(Math.random()*GHOST_COLORS.length)];
        clones.push({ track, spawnTime: elapsed, x: track[0].x, y: track[0].y, trail: [], color: ghostColor });
        clonesCreated++;
        invulnUntil = Math.max(invulnUntil, elapsed + SPAWN_INVULN_MS);
        addParticles(track[0].x, track[0].y, 'rgba(230,230,255,0.8)', 12);
      }
    }

    // update clones (looping playback) + trail
    for(const c of clones){
      const trackDuration = c.track[c.track.length-1].t || 1;
      let tt = ((elapsed - c.spawnTime) * difficultyMult) % trackDuration;
      let idx = 0;
      for(let i=0;i<c.track.length-1;i++){
        if(tt >= c.track[i].t && tt <= c.track[i+1].t){ idx = i; break; }
        idx = i;
      }
      const a = c.track[idx], b = c.track[Math.min(idx+1, c.track.length-1)];
      const span = Math.max(1, b.t - a.t);
      const f = Math.max(0, Math.min(1, (tt - a.t)/span));
      c.x = a.x + (b.x-a.x)*f;
      c.y = a.y + (b.y-a.y)*f;

      c.trail.push({x:c.x, y:c.y});
      if(c.trail.length > TRAIL_LENGTH) c.trail.shift();
    }

    // movers
    for(const m of movers){
      m.t += dt * m.speed * difficultyMult;
      const f = (Math.sin(m.t)+1)/2;
      m.x = m.ax + (m.bx-m.ax)*f;
      m.y = m.ay + (m.by-m.ay)*f;
    }

    // power-up spawning
    if(elapsed - lastPowerupAt >= POWERUP_INTERVAL_MS){
      lastPowerupAt = elapsed;
      if(powerups.length < 2) spawnPowerup();
    }

    // coins (with magnet effect)
    const magnetActive = activeEffects.magnet > 0;
    for(let i=coins.length-1;i>=0;i--){
      const c = coins[i];
      let d = Math.hypot(player.x-c.x, player.y-c.y);
      if(magnetActive && d < 180){
        const ang = Math.atan2(player.y-c.y, player.x-c.x);
        c.x += Math.cos(ang) * 260 * dt;
        c.y += Math.sin(ang) * 260 * dt;
        d = Math.hypot(player.x-c.x, player.y-c.y);
      }
      if(d < PLAYER_R + c.r){
        coins.splice(i,1);
        coinCount++;
        score += 10;
        sfx.coin();
        addParticles(c.x,c.y,'#3fd0ff',14);
        spawnCoin();
      }
    }

    // power-up pickup
    for(let i=powerups.length-1;i>=0;i--){
      const p = powerups[i];
      const d = Math.hypot(player.x-p.x, player.y-p.y);
      if(d < PLAYER_R + p.r){
        powerups.splice(i,1);
        sfx.power();
        addParticles(p.x,p.y, p.type==='shield'?'#4dffb0':(p.type==='speed'?'#ffd76b':'#ff5fa2'), 16);
        if(p.type === 'shield'){ activeEffects.shield = 5000; invulnUntil = Math.max(invulnUntil, elapsed + 5000); }
        else if(p.type === 'speed'){ activeEffects.speed = 6000; }
        else if(p.type === 'magnet'){ activeEffects.magnet = 7000; }
      }
    }

    // tick down active effects
    for(const key of Object.keys(activeEffects)){
      if(activeEffects[key] > 0){ activeEffects[key] = Math.max(0, activeEffects[key] - dt*1000); }
    }
    renderPowerupHud();

    // time-based score
    score = coinCount*10 + Math.floor(elapsed/1000);

    // collisions (death) — shield/invuln protects
    const shielded = activeEffects.shield > 0 || elapsed <= invulnUntil;
    if(!shielded){
      for(const c of clones){
        const d = Math.hypot(player.x-c.x, player.y-c.y);
        if(d < PLAYER_R + CLONE_R - 2){ gameOver(); return; }
      }
      for(const m of movers){
        const d = Math.hypot(player.x-m.x, player.y-m.y);
        if(d < PLAYER_R + m.r - 2){ gameOver(); return; }
      }
    }

    // particles
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
      if(p.life <= 0) particles.splice(i,1);
    }

    if(shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    // HUD text
    document.getElementById('hudTime').textContent = Math.floor(elapsed/1000);
    document.getElementById('hudScore').textContent = score;
  }

  /* ============ Render ============ */
  function render(now){
    ctx.save();
    ctx.clearRect(0,0,ARENA_W,ARENA_H);

    ctx.fillStyle = '#050510';
    ctx.fillRect(0,0,ARENA_W,ARENA_H);
    ctx.strokeStyle = 'rgba(80,100,160,0.08)';
    ctx.lineWidth = 1;
    for(let x=0;x<ARENA_W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ARENA_H); ctx.stroke(); }
    for(let y=0;y<ARENA_H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(ARENA_W,y); ctx.stroke(); }

    if(shakeT > 0){
      const dx = (Math.random()-0.5)*shakeMag*(shakeT/0.3);
      const dy = (Math.random()-0.5)*shakeMag*(shakeT/0.3);
      ctx.translate(dx,dy);
    }

    // walls
    ctx.fillStyle = 'rgba(63,208,255,0.12)';
    ctx.strokeStyle = 'rgba(63,208,255,0.55)';
    ctx.lineWidth = 1.5;
    for(const w of walls){ ctx.fillRect(w.x,w.y,w.w,w.h); ctx.strokeRect(w.x,w.y,w.w,w.h); }

    // coins
    for(const c of coins){
      ctx.save();
      ctx.translate(c.x,c.y);
      ctx.rotate(now/300 + c.spin);
      const grad = ctx.createRadialGradient(0,0,0,0,0,c.r*2.2);
      grad.addColorStop(0,'rgba(255,255,255,0.9)');
      grad.addColorStop(0.4,'rgba(63,208,255,0.9)');
      grad.addColorStop(1,'rgba(63,208,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0,0,c.r*2.2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#eaffff';
      ctx.beginPath(); ctx.arc(0,0,c.r*0.55,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // power-ups
    for(const p of powerups){
      const bobY = Math.sin(now/240 + p.bob) * 4;
      ctx.save();
      ctx.translate(p.x, p.y+bobY);
      const color = p.type==='shield' ? '#4dffb0' : (p.type==='speed' ? '#ffd76b' : '#ff5fa2');
      const grad = ctx.createRadialGradient(0,0,0,0,0,p.r*2.6);
      grad.addColorStop(0, color+'cc'.replace('cc','')); // fallback
      grad.addColorStop(0, hexToRgba(color,0.85));
      grad.addColorStop(1, hexToRgba(color,0));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0,0,p.r*2.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0,0,p.r,0,Math.PI*2); ctx.fill();
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.type==='shield'?'🟢':(p.type==='speed'?'⚡':'🧲'), 0, 1);
      ctx.restore();
    }

    // movers — red "hunter" ghosts (moving obstacles), fully opaque and more solid-looking than shadow ghosts
    for(const m of movers){
      const bobY = Math.sin(now/220 + m.ax) * 2;
      ctx.save();
      ctx.translate(m.x, m.y+bobY);
      const grad = ctx.createRadialGradient(0,0,0,0,0,m.r*2.6);
      grad.addColorStop(0,'rgba(255,70,70,0.45)');
      grad.addColorStop(1,'rgba(255,70,70,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0,0,m.r*2.6,0,Math.PI*2); ctx.fill();
      drawGhostBody(ctx, m.r, 'rgba(255,90,90,0.92)', 'rgba(255,160,160,0.85)', 'rgba(40,5,5,0.85)');
      ctx.restore();
    }

    // clones — cute floating ghosts: transparent, dim glow, fading trail, gentle bob, varied colors
    for(const c of clones){
      const invuln = elapsed <= invulnUntil;
      const bobY = Math.sin(now/280 + c.spawnTime) * 2.5;
      const gc = c.color || GHOST_COLORS[0];

      // fading trail
      for(let i=0;i<c.trail.length;i++){
        const tpt = c.trail[i];
        const a = (i/c.trail.length) * 0.16;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgba(${gc.glow},1)`;
        ctx.beginPath();
        ctx.arc(tpt.x, tpt.y, CLONE_R*0.7, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(c.x, c.y+bobY);
      ctx.globalAlpha = invuln ? 0.26 : 0.55; // ghostly, ~40-45% opaque
      // dim glow, softer than the player's, tinted to this ghost's color
      const grad = ctx.createRadialGradient(0,0,0,0,0,CLONE_R*1.7);
      grad.addColorStop(0, `rgba(${gc.glow},0.28)`);
      grad.addColorStop(1, `rgba(${gc.glow},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0,0,CLONE_R*1.7,0,Math.PI*2); ctx.fill();

      drawGhostBody(ctx, CLONE_R, gc.fill, gc.stroke);

      ctx.restore();
    }

    // particles
    for(const p of particles){
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // player — neon cat, brighter glow than the ghosts so it's unmistakably "real"
    ctx.save();
    ctx.translate(player.x, player.y);
    const shielded = activeEffects.shield > 0;
    const inv = elapsed <= invulnUntil;
    ctx.globalAlpha = (inv && !shielded) ? (0.5 + 0.5*Math.sin(now/50)) : 1;
    const pg = ctx.createRadialGradient(0,0,0,0,0,PLAYER_R*3.2);
    pg.addColorStop(0,'rgba(63,208,255,0.95)');
    pg.addColorStop(1,'rgba(63,208,255,0)');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(0,0,PLAYER_R*3.2,0,Math.PI*2); ctx.fill();
    if(shielded){
      ctx.strokeStyle = 'rgba(77,255,176,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0,0,PLAYER_R+10,0,Math.PI*2); ctx.stroke();
    }

    // facing direction tilts the cat slightly toward movement
    const faceAng = (player.vx||0) !== 0 || (player.vy||0) !== 0 ? Math.atan2(player.vy||0, player.vx||0) : 0;
    drawCatBody(ctx, PLAYER_R);

    ctx.restore();

    ctx.restore();
  }

  /* ============ Character shape drawing helpers ============ */
  function drawGhostBody(ctx, r, fillColor, strokeColor, eyeColor){
    fillColor = fillColor || 'rgba(220,205,255,0.65)';
    strokeColor = strokeColor || 'rgba(235,225,255,0.55)';
    eyeColor = eyeColor || 'rgba(40,25,70,0.75)';
    // rounded dome top + scalloped wavy bottom, simple dot eyes — matches classic friendly-ghost look
    ctx.beginPath();
    ctx.moveTo(-r, r*0.15);
    ctx.arc(0, 0, r, Math.PI, 0, false); // dome from left to right through the top
    ctx.lineTo(r, r*0.85);
    const bumps = 3;
    const seg = (2*r) / bumps;
    for(let i=0;i<bumps;i++){
      const xA = r - seg*i;
      const xB = r - seg*(i+1);
      const xMid = (xA+xB)/2;
      const dipY = (i % 2 === 0) ? r*1.15 : r*0.75;
      ctx.quadraticCurveTo(xMid, dipY, xB, r*0.85);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();

    // simple dot eyes + small o mouth
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.arc(-r*0.32, -r*0.05, r*0.11, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(r*0.32, -r*0.05, r*0.11, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, r*0.22, r*0.09, 0, Math.PI*2); ctx.fill();
  }

  function drawCatBody(ctx, r){
    // ears (drawn first so the head circle overlaps their base)
    ctx.fillStyle = '#3fd0ff';
    drawEar(ctx, -1, r);
    drawEar(ctx, 1, r);
    // inner ears
    ctx.fillStyle = 'rgba(255,180,210,0.85)';
    drawInnerEar(ctx, -1, r);
    drawInnerEar(ctx, 1, r);

    // head
    ctx.fillStyle = '#3fd0ff';
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();

    // face shading circle (subtle)
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(-r*0.2,-r*0.15,r*0.55,0,Math.PI*2); ctx.fill();

    // eyes
    ctx.fillStyle = '#08131c';
    ctx.beginPath(); ctx.ellipse(-r*0.33, -r*0.05, r*0.11, r*0.14, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r*0.33, -r*0.05, r*0.11, r*0.14, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-r*0.30,-r*0.08,r*0.03,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(r*0.36,-r*0.08,r*0.03,0,Math.PI*2); ctx.fill();

    // nose
    ctx.fillStyle = 'rgba(255,170,200,0.95)';
    ctx.beginPath();
    ctx.moveTo(0, r*0.14);
    ctx.lineTo(-r*0.08, r*0.22);
    ctx.lineTo(r*0.08, r*0.22);
    ctx.closePath();
    ctx.fill();

    // whiskers
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for(const side of [-1,1]){
      for(const off of [-0.06, 0.02, 0.10]){
        ctx.beginPath();
        ctx.moveTo(side*r*0.35, r*0.22+off*r);
        ctx.lineTo(side*r*0.95, r*0.14+off*r*1.3);
        ctx.stroke();
      }
    }
  }
  function drawEar(ctx, side, r){
    ctx.beginPath();
    ctx.moveTo(side*r*0.55, -r*0.62);
    ctx.lineTo(side*r*0.95, -r*1.32);
    ctx.lineTo(side*r*0.15, -r*0.92);
    ctx.closePath();
    ctx.fill();
  }
  function drawInnerEar(ctx, side, r){
    ctx.beginPath();
    ctx.moveTo(side*r*0.55, -r*0.68);
    ctx.lineTo(side*r*0.78, -r*1.08);
    ctx.lineTo(side*r*0.32, -r*0.86);
    ctx.closePath();
    ctx.fill();
  }

  function hexToRgba(hex, alpha){
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16);
    const g = parseInt(h.substring(2,4),16);
    const b = parseInt(h.substring(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ============ Init ============ */
  resize();
  goMenu();
})();
