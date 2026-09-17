(() => {
  const PRICE_PER_KG = 450;
  const routeValues = { pdp: 25, mdz: 42, regional: 32 };
  const journey = document.querySelector('.journey');
  const experience = document.querySelector('.experience');
  experience.parentNode.insertBefore(journey, experience);

  const flightCodes = { HA101: 'pdp', HA204: 'mdz', HA330: 'regional' };
  const form = document.querySelector('#flight-lookup');
  const input = document.querySelector('#flight-code');
  const feedback = document.querySelector('#lookup-feedback');

  const choice = document.createElement('div');
  choice.className = 'compensation-choice';
  choice.innerHTML = `
    <strong class="choice-title">Elegir otra cantidad</strong>
    <span class="hint">Opcional. Si no ingresás nada, compensás la estimación completa del vuelo.</span>
    <div class="custom-kg show" id="custom-kg-wrap">
      <div class="kg-input"><input id="custom-kg-input" type="number" min="1" max="10000" step="1" placeholder="Ej. 10" aria-label="Kilogramos que querés compensar"><span>kg de CO₂</span></div>
      <p class="custom-help" id="custom-help">Ingresá una cantidad para calcular el aporte.</p>
    </div>`;
  document.querySelector('.passengers').insertAdjacentElement('afterend', choice);

  const customInput = document.querySelector('#custom-kg-input');
  const customHelp = document.querySelector('#custom-help');

  function selectedFlightKg() {
    const key = document.querySelector('.route.selected')?.dataset.flight || 'pdp';
    const passengers = Number(document.querySelector('#people').textContent) || 1;
    return routeValues[key] * passengers;
  }

  function updateCompensationChoice() {
    const fullKg = selectedFlightKg();
    const hasCustomValue = customInput.value.trim() !== '';
    if (!hasCustomValue) {
      const routeName = document.querySelector('.route.selected .route-copy strong').textContent;
      const passengers = Number(document.querySelector('#people').textContent) || 1;
      document.querySelector('#kg').textContent = fullKg.toLocaleString('es-AR');
      document.querySelector('#amount').textContent = (fullKg * PRICE_PER_KG).toLocaleString('es-AR');
      document.querySelector('#summary').textContent = `Estimación para ${passengers} ${passengers === 1 ? 'persona' : 'personas'} en el vuelo ${routeName}.`;
      document.querySelector('#preview-kg').textContent = fullKg.toLocaleString('es-AR');
      document.documentElement.style.setProperty('--path', Math.min(.88, (30 + fullKg * .75) / 100));
      customHelp.textContent = `Impacto completo estimado: ${fullKg.toLocaleString('es-AR')} kg · $${(fullKg * PRICE_PER_KG).toLocaleString('es-AR')}`;
      return;
    }

    const customKg = Math.max(1, Math.min(10000, Math.round(Number(customInput.value) || 1)));
    customInput.value = customKg;
    document.querySelector('#kg').textContent = customKg.toLocaleString('es-AR');
    document.querySelector('#amount').textContent = (customKg * PRICE_PER_KG).toLocaleString('es-AR');
    document.querySelector('#summary').textContent = `Elegiste compensar ${customKg.toLocaleString('es-AR')} kg de los ${fullKg.toLocaleString('es-AR')} kg estimados para esta reserva.`;
    document.querySelector('#preview-kg').textContent = customKg.toLocaleString('es-AR');
    customHelp.textContent = `Aporte para ${customKg.toLocaleString('es-AR')} kg: $${(customKg * PRICE_PER_KG).toLocaleString('es-AR')}`;
    document.documentElement.style.setProperty('--path', Math.min(.88, (30 + customKg * .75) / 100));
  }

  customInput.addEventListener('input', updateCompensationChoice);
  document.querySelectorAll('.route,#minus,#plus').forEach(control => control.addEventListener('click', updateCompensationChoice));

  form.addEventListener('submit', event => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase().replace(/\s/g, '');
    const key = flightCodes[code];
    feedback.className = 'lookup-feedback';

    if (!code) {
      feedback.textContent = 'Ingresá un código para buscar tu vuelo.';
      feedback.classList.add('error');
      return;
    }
    if (!key) {
      feedback.textContent = 'No encontramos ese código en esta demostración. Probá HA101, HA204 o HA330, o elegí una ruta manualmente.';
      feedback.classList.add('error');
      return;
    }

    document.querySelector(`[data-flight="${key}"]`).click();
    feedback.textContent = `Vuelo ${code} encontrado. Completamos la ruta automáticamente.`;
    feedback.classList.add('ok');
    document.querySelector('.result').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
  });

  const steps = [...document.querySelectorAll('.journey .step')];
  const stepsTrack = document.querySelector('.journey .steps');
  const stageLabel = document.querySelector('#journey-stage');
  const stageNames = ['Elegís tu vuelo', 'Conocés la estimación', 'Elegís participar', 'Seguís tu impacto'];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;

  function updateJourney() {
    frame = 0;
    const rect = stepsTrack.getBoundingClientRect();
    const viewportPoint = innerHeight * .62;
    const progress = Math.max(0, Math.min(1, (viewportPoint - rect.top) / Math.max(1, rect.height)));
    const activeIndex = Math.min(steps.length - 1, Math.floor(progress * steps.length));
    const travel = Math.max(0, stepsTrack.clientWidth - 28) * progress;
    stepsTrack.style.setProperty('--plane-x', `${travel}px`);
    steps.forEach((step, index) => step.classList.toggle('passed', index <= activeIndex));
    stageLabel.textContent = stageNames[activeIndex];
  }

  function requestJourneyUpdate() {
    if (frame) return;
    frame = requestAnimationFrame(updateJourney);
  }

  if (!reduceMotion) {
    addEventListener('scroll', requestJourneyUpdate, { passive: true });
    addEventListener('resize', requestJourneyUpdate, { passive: true });
  } else {
    steps.forEach(step => step.classList.add('passed'));
    stageLabel.textContent = stageNames.at(-1);
  }
  updateJourney();
})();
