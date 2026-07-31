Bundled Fonts
=============

These are the fonts the image effect engine renders text with. The mapping from
the user-facing font name to the file lives in FONT_DEFINITIONS in
src/utils/frames.js.

Any font here can be deleted. The engine checks for each file at startup and
follows a fallback chain when one is missing, so removing a font degrades to a
substitute rather than breaking the command.


A note on family names
----------------------
The `family` recorded for each font in frames.js must not contain Pango style
keywords (Bold, Black, Light, Condensed, Italic, and so on). Pango's font
description parser strips those words out of the family and reinterprets them as
weight/stretch requests, which misses the real face and renders a synthesised
fake-bold instead. That is why caption.otf is requested as plain "Futura" rather
than "Futura Extra Black Condensed" — the file declares both family names, and
only the short one survives parsing. esmBot asks for "futura" for the same
reason.


Files
-----
caption.otf
  Futura BT Extra Black Condensed. The classic meme caption face, and what
  esmBot uses for its `caption` command. Taken from esmBot
  (https://github.com/esmBot/esmBot, assets/fonts/caption.otf).
  Font name: futura
  LICENCE: Futura BT is a commercial typeface from Bitstream. esmBot's own
  repository is MIT licensed but that licence covers its code, not the foundry's
  font. Redistributing this file is legally uncertain. It is here because it is
  the only way to match esmBot's caption output exactly. If that matters for
  your deployment, delete it — the engine falls back to
  FuturaCyrillicExtraBold.ttf automatically, and `font: futura-pt` selects that
  face explicitly either way.

caption2.ttf
  Helvetica Neue. What esmBot uses for its `caption2` (iFunny-style) captions
  and for `snapchat`. Taken from esmBot (assets/fonts/caption2.ttf).
  Font name: helvetica
  LICENCE: Helvetica Neue is a commercial typeface from Linotype/Monotype. The
  same caveat as caption.otf applies. Deleting it falls back to Liberation Sans,
  which is metric-compatible with Arial.

Anton-Regular.ttf
  Anton. Stands in for Impact, which cannot be redistributed. Anton is the
  closest free match in weight and width.
  Font name: impact
  LICENCE: SIL Open Font License 1.1. Safe to redistribute.

reddit.ttf
  Roboto. Taken from esmBot (assets/fonts/reddit.ttf).
  Font name: roboto
  LICENCE: Apache License 2.0. Safe to redistribute.

Ubuntu.ttf
  Ubuntu. Taken from esmBot (assets/fonts/Ubuntu.ttf).
  Font name: ubuntu
  LICENCE: Ubuntu Font Licence 1.0. Safe to redistribute.

FuturaCyrillicExtraBold.ttf
  Futura PT Extra Bold. The caption font this bot used before esmBot's face was
  vendored. Kept so the previous look is still reachable, and as the fallback
  for `futura`.
  Font name: futura-pt


System fonts
------------
These font names resolve through the host's fontconfig instead of a bundled
file, so they need the relevant package installed (fonts-liberation and
fonts-dejavu on Debian/Ubuntu):

  arial  -> Liberation Sans   (metric-compatible with Arial)
  times  -> Liberation Serif  (metric-compatible with Times New Roman)
  serif  -> DejaVu Serif
  sans   -> DejaVu Sans
  mono   -> DejaVu Sans Mono

esmBot also offers `noto` and `comic sans ms`. Neither is offered here: there is
no bundled file for them, and if the host lacks the font, fontconfig silently
renders something else instead of reporting the problem.
