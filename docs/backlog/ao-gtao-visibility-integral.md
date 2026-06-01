# Backlog: full GTAO visibility integral + multi-bounce term

## Why

ADR-0054 ships ambient occlusion as a horizon-based, normal-oriented estimator
(the GTAO / HBAO family): per slice it marches the depth buffer, accumulates
`max(N·dir − bias, 0)` with a distance falloff, and powers the result by the
intensity. It is correct and produces convincing contact AO, but it is not the
full *ground-truth* GTAO formulation:

- The true GTAO computes a **cosine-weighted horizon integral** per slice —
  finding the two horizon angles `h1`, `h2` and integrating the visible arc
  against the projected-normal cosine — which is closer to the analytic
  hemisphere occlusion than the current sum-of-samples estimate.
- GTAO's optional **multi-bounce** approximation (a cubic of the AO value tinted
  by albedo) restores light that the single-bounce occlusion over-darkens, which
  matters once IBL (Phase 10.7) makes the indirect term colored rather than a
  flat grey ambient.

## Scope

- Replace the per-slice accumulation with the cosine-weighted horizon-angle
  integral (project the view-space normal into each slice plane, find `h1`/`h2`,
  integrate).
- Add the multi-bounce term (gated/tunable), wired to albedo once IBL lands.
- Re-tune the `ScreenSpaceAo` defaults (radius / bias / slices / steps) against
  the new integral and update the bench baseline.

## Done definition

The AO pass computes the cosine-weighted GTAO horizon integral (with optional
multi-bounce) and matches a reference within tolerance on the `?mode=ao` scene,
with no regression in the per-frame bench. Deferred — the shipped estimator is a
correct, device-verified v1; this is a quality upgrade, not a fix, and the
multi-bounce half is most valuable alongside IBL.
