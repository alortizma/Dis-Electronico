# 🌿 Proyecto Cafecito — Juego de Realidad Mixta

Inspector de plantas de café en **mixed reality**. Con la cámara ves plantas de
café holográficas a tu alrededor; escudriñalas con la pantalla para descubrir
su estado y **cura las enfermas** antes de que se agote el tiempo.

* **2D / móvil / escritorio:** arrastrar para girar la vista, toque directo en
  una planta para escanearla, D-pad para mover/acercar, teclado (ASDW + flechas).
* **🥽 Meta Quest (VR):** modo WebXR con **cámara real en passthrough** — las
  plantas 3D aparecen en tu sala, escaneo con la mirada y panel flotante con
  los botones del mando.

---

## 🚀 Jugar en Meta Quest (recomendado)

> **Requisito:** las gafas necesitan una URL segura (HTTPS). GitHub Pages la
> provee; eso es exactamente por qué el juego vive en GitHub.

### 1. Sube el repo a GitHub y activa GitHub Pages

1. Crea un repo (ej. `proyecto-cafecito`) y sube todo este folder.
2. Ve a **Settings → Pages → Build and deployment → Source**.
3. Elige **GitHub Actions** (el workflow `.github/workflows/deploy.yml` ya está
   incluido y publica automáticamente en cada push a `main`).
   *(Opcional: en Allow pages to be served from a custom domain, ponte el tuyo.)*

### 2. Abre el juego en las gafas

1. En el **Meta Quest Browser** escribe:
   `https://TU_USUARIO.github.io/proyecto-cafecito/`
2. La pantalla de inicio muestra dos botones:
   * **▶ JUGAR** → modo clásico (pantalla plana dentro del visor).
   * **🥽 JUGAR EN META QUEST (VR)** → **modo realidad mixta**: se pide permiso
     de WebXR, entras en passthrough y aparecen las plantas en tu sala real.
3. **Controles en VR:**
   | Acción | Control |
   |---|---|
   | Mirar / escanear | La cabeza (la planta centrada en el visor se escanea en ~1.3 s) |
   | Moverse (avanzar/retroceder/deslizar) | Thumbstick **izquierdo** |
   | Curar / confirmar | **Gatillo** o botón **A** apuntando al botón flotante |
   | Cerrar panel | Botón **B** |
   | Salir de VR | Menú del sistema (==) |

**Consejos Quest:** jugar de pie o sentado en un espacio claro; el primer nivel
tener 2-3 m libres a tu alrededor; si el passthrough no se activa (versión
antigua del navegador), el fondo se muestra oscuro pero el juego igual jugable.

---

## 💻 Jugar en el navegador (PC / móvil)

```bash
cd proyecto-cafecito
python3 -m http.server 8000
# abrir http://localhost:8000
```

* **Escaneo:** apuntar una planta con la pantalla (visor central) durante
  1.3 s **o tocarla directamente**.
* **Mover/girar:** arrastrar; **D-pad**: ◀▶ girar, ▲▼ mirar, ◀▶ (segundo
  grupo) acercar/alejar; teclado: flechas + W/S.
* **Curar:** abrir el panel al escanear una planta enferma y tocar 🌿 CURAR.
* Sin cámara web: se sirve el modo simulado (fondo holo).

---

## 🏗️ Estructura

```
proyecto-cafecito/
├── index.html            # juego 2D (autocontenido: HTML + CSS + JS)
├── quest-mr.js           # motor WebXR para Meta Quest (modo realidad mixta)
├── manifest.json         # PWA (instalable en Quest Browser)
├── assets/logo.png       # logo/splash
└── .github/workflows/deploy.yml  # publicación automática a GitHub Pages
```

`quest-mr.js` se carga con `defer` y se activa solo si el navegador soporta
WebXR (`immersive-vr`); sin Quest, la página funciona igual sin él.

## 🔊 Sonido

Web Audio API sintético (sin archivos): aim, lock, cure, win/lose. El botón
🔊 del HUD activa/desactiva. En Quest: audio espacial nativo del navegador.

## ⏱️ Niveles

| Nivel | Plantas | Enfermas | Tiempo |
|---|---|---|---|
| 1 · Finca El Cafecito | 4 | 1 | 70 s |
| 2 · Plantación Sur | 6 | 2 | 90 s |
| 3 · Tesis del Campo | 8 | 3 | 110 s |

Cura = +100 ⭐ +1 ☕ · confirmar sana = +20 ⭐ · pierdes si el tiempo se agota
con plantas enfermas sin curar.

## 🧪 Compatibilidad

* Meta Quest 2 / 3 / Pro — Meta Quest Browser (WebXR + passthrough).
* Chrome desktop con WebXR/VR headset.
* Móviles/tablets/PC sin WebXR — modo 2D (toque/arrastre).
