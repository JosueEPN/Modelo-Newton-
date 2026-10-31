# Modelo-Newton-

Simulador educativo de la **Ley de Enfriamiento de Newton** aplicada a estimar la hora de muerte.

dT/dt = −k·(T − Ta)  →  T(t) = Ta + (T0 − Ta)·e^(−k·t)

## Cómo abrirlo

Doble clic en `index.html`. Funciona sin internet y sin instalar nada.

## Qué incluye

- **Simulador:** campo de direcciones, isoclinas, equilibrio, curvas solución con RK4 (clic en el plano) y una ilustración propia (SVG) del cuerpo que cambia con el tiempo desde la muerte: palidez, livideces, rigidez, mancha verde, hinchazón y esqueletización.
- **Cálculos paso a paso:** solución analítica con los valores actuales, calculadora interactiva y tabla analítica vs. RK4.

Ejercicio por defecto: cuerpo hallado a las 10:00 p.m. con 30 °C, 28 °C una hora después, cuarto a 20 °C → k ≈ 0.2231 h⁻¹, muerte ≈ 7:37 p.m.

## Estructura

```
index.html        estructura de la página
css/estilos.css   tema y diseño responsive
js/app.js         modelo, solver RK4, render del lienzo, ilustración del cuerpo e interfaz
```
