// Reforestall — comportamiento compartido del sitio (nav, reveal, árbol interactivo)

(function navToggle(){
  const btn = document.querySelector('.nav-toggle');
  if(!btn) return;
  btn.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.addEventListener('click', () => document.body.classList.remove('nav-open'));
  });
})();

(function markActiveNav(){
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a[data-page]').forEach(a => {
    if(a.dataset.page.split(' ').includes(path)) a.classList.add('active');
  });
})();

// ---------------------------------------------------------------------------
// Contador tipo odómetro: cuenta de 0 al valor real cuando el número entra en
// pantalla, en vez de aparecer ya plantado.
// ---------------------------------------------------------------------------
(function countUpNumbers(){
  const targets = document.querySelectorAll('[data-count-to]');
  if(!targets.length) return;

  function animate(el){
    const to = parseInt(el.dataset.countTo, 10);
    const suffix = el.dataset.suffix || '';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduceMotion || !to){
      el.textContent = to.toLocaleString('es-AR') + suffix;
      return;
    }
    const duration = 1700;
    const start = performance.now();
    function easeOutExpo(t){ return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
    function tick(now){
      const t = Math.min(1, (now - start) / duration);
      const value = Math.round(to * easeOutExpo(t));
      el.textContent = value.toLocaleString('es-AR') + suffix;
      if(t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if(!('IntersectionObserver' in window)){
    targets.forEach(animate);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        animate(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  targets.forEach(t => io.observe(t));
})();

(function revealOnScroll(){
  const targets = document.querySelectorAll('.reveal, .reveal-stagger');
  if(!('IntersectionObserver' in window) || !targets.length){
    targets.forEach(t => t.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -60px 0px' });
  targets.forEach(t => io.observe(t));
})();

// ---------------------------------------------------------------------------
// Hero fijo: dos escenas se funden dentro del mismo frame pinneado — la
// cámara no se mueve, el árbol tampoco cambia de lugar; lo que cambia
// alrededor es el foco (intro → la ecuación completa). El progreso de scroll
// se emite como evento para que el árbol también "crezca" al bajar, no solo
// al mover el mouse.
// ---------------------------------------------------------------------------
(function pinnedHero(){
  const pin = document.querySelector('#hero-pin');
  if(!pin) return;
  const sceneA = pin.querySelector('.scene-a');
  const sceneB = pin.querySelector('.scene-b');
  const dots = pin.querySelectorAll('.hero-progress span');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if(reduceMotion || !sceneA || !sceneB){
    document.documentElement.classList.add('no-pin');
    return;
  }

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  const mobileQuery = window.matchMedia('(max-width: 900px)');

  let ticking = false;
  function update(){
    ticking = false;
    // Debajo de 900px el CSS ya apila las dos escenas en flujo normal (ver
    // media query). Si no limpiamos los estilos inline que dejó el modo
    // pinneado, scene-b puede quedar con opacity:0 pisando ese fallback.
    if(mobileQuery.matches){
      [sceneA, sceneB].forEach(s => { s.style.opacity = ''; s.style.transform = ''; s.style.pointerEvents = ''; });
      return;
    }
    const total = pin.offsetHeight - window.innerHeight;
    if(total <= 0) return;
    const scrolled = -pin.getBoundingClientRect().top;
    const p = Math.min(1, Math.max(0, scrolled / total));

    const outA = smoothstep(0.30, 0.52, p);
    const inB = smoothstep(0.44, 0.68, p);

    sceneA.style.opacity = String(1 - outA);
    sceneA.style.transform = `translateY(${-26 * outA}px)`;
    sceneA.style.pointerEvents = outA > 0.6 ? 'none' : 'auto';

    sceneB.style.opacity = String(inB);
    sceneB.style.transform = `translateY(${22 * (1 - inB)}px)`;
    sceneB.style.pointerEvents = inB > 0.4 ? 'auto' : 'none';

    dots.forEach(d => d.classList.toggle('on', d.dataset.scene === (inB > 0.5 ? 'b' : 'a')));

    document.dispatchEvent(new CustomEvent('reforestall:heroprogress', { detail: { p } }));
  }
  function onScroll(){ if(!ticking){ requestAnimationFrame(update); ticking = true; } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();

// ---------------------------------------------------------------------------
// Foto del hero: un glow ámbar sigue al cursor con un resorte suave (lerp,
// mismo principio de "look-at" que tenía el árbol antes), y la foto se
// desplaza levemente en la dirección opuesta (parallax). El progreso de
// scroll del hero (ver pinnedHero) suma un zoom sutil, tipo Ken Burns.
// ---------------------------------------------------------------------------
(function heroPhotoFX(){
  const photo = document.querySelector('#hero-photo');
  const glow = document.querySelector('#hero-glow');
  const img = document.querySelector('#hero-photo-img');
  if(!photo || !glow || !img) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let target = { x: 30, y: 30 };
  let current = { x: 30, y: 30 };
  let scrollP = 0;

  document.addEventListener('reforestall:heroprogress', (e) => {
    scrollP = e.detail.p;
    img.style.setProperty('--scz', String(scrollP * 0.05));
    img.style.filter = `brightness(${1 + scrollP * 0.12})`;
  });

  function setFromPointer(clientX, clientY){
    const rect = photo.getBoundingClientRect();
    target.x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    target.y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
  }

  function loop(){
    current.x += (target.x - current.x) * 0.05;
    current.y += (target.y - current.y) * 0.05;
    glow.style.setProperty('--mx', current.x + '%');
    glow.style.setProperty('--my', current.y + '%');
    // parallax sutil: la foto se corre unos px en sentido opuesto al cursor
    const px = ((current.x - 50) / 50) * -14;
    const py = ((current.y - 50) / 50) * -10;
    img.style.setProperty('--px', px.toFixed(1) + 'px');
    img.style.setProperty('--py', py.toFixed(1) + 'px');
    requestAnimationFrame(loop);
  }

  if(!reduceMotion){
    window.addEventListener('mousemove', (e) => setFromPointer(e.clientX, e.clientY), { passive: true });
    loop();
  }
})();
