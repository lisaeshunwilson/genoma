// Genoma Institute — shared site behavior (scroll reveal + accessible mobile nav)
(function(){
  const reveals = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); } });
  },{threshold:0.15});
  reveals.forEach(el=>io.observe(el));

  const menuBtn = document.querySelector('.menu-btn');
  const navlinks = document.querySelector('.navlinks');
  if(menuBtn && navlinks){
    const closeMenu = () => {
      navlinks.classList.remove('is-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      navlinks.classList.add('is-open');
      menuBtn.setAttribute('aria-expanded', 'true');
    };
    menuBtn.addEventListener('click', () => {
      navlinks.classList.contains('is-open') ? closeMenu() : openMenu();
    });
    navlinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', () => {
      if(window.innerWidth > 860) closeMenu();
    });
  }
})();
