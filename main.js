// Genoma Institute — shared site behavior (scroll reveal + accessible mobile nav)
(function(){
  var reveals = document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window && reveals.length){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    },{threshold:0.15});
    reveals.forEach(function(el){ io.observe(el); });
  } else {
    reveals.forEach(function(el){ el.classList.add('in'); });
  }

  var toggle = document.querySelector('.nav-toggle');
  var panel = document.getElementById('primary-nav');
  if(toggle && panel){
    var closeNav = function(){
      toggle.setAttribute('aria-expanded','false');
      panel.classList.remove('is-open');
    };
    var openNav = function(){
      toggle.setAttribute('aria-expanded','true');
      panel.classList.add('is-open');
    };
    toggle.addEventListener('click', function(){
      var isOpen = toggle.getAttribute('aria-expanded') === 'true';
      isOpen ? closeNav() : openNav();
    });
    panel.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', closeNav);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeNav();
    });
    window.addEventListener('resize', function(){
      if(window.innerWidth > 900) closeNav();
    });
  }

  // Prevent social chip clicks from toggling an ancestor <details> accordion
  document.querySelectorAll('.social-chip').forEach(function(el){
    el.addEventListener('click', function(e){ e.stopPropagation(); });
  });
})();
