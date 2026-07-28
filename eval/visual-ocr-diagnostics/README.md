# Visual OCR Diagnostics

This evaluation surface contains three public synthetic text-truth fixtures and
one deterministic report compiled against the committed VISION-009 OCR
observations. Truth labels come only from the VISION-007 renderer's explicit
text declarations and are bound to renderer, source, crop, preprocessing, and
OCR result bytes.

The report measures exact case-sensitive text plus positive-overlap detection
on these fixed fixtures. Partially clipped labels are excluded from recall and
can only produce unscored observations. The metrics are not human ground truth,
a production OCR benchmark, OCR acceptance, layout semantics, FigureUnderstanding,
Track B, workflow integration, or live acceptance.
