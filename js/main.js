function getColour() {
  // Credit to https://kentor.me/posts/generating-pastel-colors-for-css/
  var hue = Math.floor(Math.random() * 360);
  var pastel = 'hsl(' + hue + ', 100%, 87.5%)';
  return pastel;
}

$(document).ready(function() {
  var highlight = getColour();
  $('.site-header').css('background-color', highlight);
  $('.site-footer').css('background-color', highlight);

  if (location.protocol.startsWith('dat')) {
    $('.dat').css('display', 'none');
  }
});
