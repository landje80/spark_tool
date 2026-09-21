---
paths:
  - 'src/modules/content-intake/**'
  - 'src/modules/media-processing/**'
  - 'src/integrations/storage/**'
---

# Uploads en mediaverwerking

- Originelen onveranderlijk; afgeleiden als aparte `MediaAsset`.
- Valideer MIME via content-sniffing, grootte en aantal; genereer bestandsnamen zelf; nooit gebruikerspad gebruiken.
- Opslag buiten de document root; downloads via gecontroleerde route.
- Formaten/limieten/presets uit configuratie, niet hardcoded. ffmpeg/sharp ontbreken = feature uit, app blijft draaien.
- Uploadtokens: alleen hash opslaan, vervaldatum, intrekbaar.
