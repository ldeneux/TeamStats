# -*- coding: utf-8 -*-
"""
Mise à jour du mode d'emploi TeamStats.

Le guide d'origine (docs/mode-emploi-base-v1.pdf, 13 pages) est conservé : ses pages 2 à 11 restent telles quelles,
trois passages devenus obsolètes sont retouchés par superposition, et les pages suivantes sont reconstruites dans le
même style : page d'accueil / programme, étape 12 (menu Calendrier), annexe A (module administrateur).

Usage : python3 build_guide.py BASE.pdf SORTIE.pdf
"""
import io, sys
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (BaseDocTemplate, Flowable, CondPageBreak, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)

BASE = sys.argv[1] if len(sys.argv) > 1 else 'base_v1.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'out.pdf'
import os
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'guide-assets')

import re
def _read_version():
    """Numéro de version : la même valeur que celle affichée dans l'appli (lib/appVersion.ts)."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib', 'appVersion.ts')
    try: return re.search(r"APP_VERSION\s*=\s*'([^']+)'", open(p, encoding='utf-8').read()).group(1)
    except Exception: return ''
VERSION = _read_version()

# ------------------------------------------------------------------ polices et couleurs (celles du guide d'origine)
G = '/usr/share/fonts/truetype/google-fonts/'
C = '/usr/share/fonts/truetype/crosextra/'
for name, path in [('Poppins-Bold', G + 'Poppins-Bold.ttf'), ('Poppins-Medium', G + 'Poppins-Medium.ttf'),
                   ('Poppins-Light', G + 'Poppins-Light.ttf'), ('Carlito', C + 'Carlito-Regular.ttf'),
                   ('Carlito-Bold', C + 'Carlito-Bold.ttf'), ('Carlito-Italic', C + 'Carlito-Italic.ttf'),
                   ('Carlito-BoldItalic', C + 'Carlito-BoldItalic.ttf'),
                   ('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]:
    pdfmetrics.registerFont(TTFont(name, path))
pdfmetrics.registerFontFamily('Carlito', normal='Carlito', bold='Carlito-Bold', italic='Carlito-Italic', boldItalic='Carlito-BoldItalic')

NAVY, AMBER, AMBER_D = HexColor('#0B1B3A'), HexColor('#F59E0B'), HexColor('#D97706')
BLUE, GREEN, RED = HexColor('#2563EB'), HexColor('#059669'), HexColor('#E11D48')
TEXT, MUTED, LINE = HexColor('#1E293B'), HexColor('#64748B'), HexColor('#E2E8F0')
LIGHTBLUE = HexColor('#93C5FD')
PW, PH = 595.2756, 841.8898
LM, CW = 51.0, 493.3

body = ParagraphStyle('body', fontName='Carlito', fontSize=10.6, leading=14.6, textColor=TEXT, spaceAfter=6)
small = ParagraphStyle('small', parent=body, fontSize=9.2, leading=12.5, textColor=MUTED)
h2 = ParagraphStyle('h2', fontName='Poppins-Bold', fontSize=12.5, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=6)
h1 = ParagraphStyle('h1', fontName='Poppins-Bold', fontSize=22, leading=26, textColor=NAVY, spaceAfter=6)
cell = ParagraphStyle('cell', fontName='Carlito', fontSize=10, leading=13, textColor=TEXT)
cellb = ParagraphStyle('cellb', parent=cell, fontName='Carlito-Bold')
caption = ParagraphStyle('caption', fontName='Carlito-Italic', fontSize=8.6, leading=11, textColor=MUTED, alignment=1, spaceBefore=3, spaceAfter=9)

CHIP = {'gray': '#E2E8F0', 'blue': '#E0E7FF', 'green': '#D1FAE5', 'red': '#FFE4E6', 'yellow': '#FEF3C7'}
def chip(text, kind='gray'):
    return f'<font name="Carlito-Bold" backColor="{CHIP[kind]}">&nbsp;{text}&nbsp;</font>'
def b(text):
    return f'<b>{text}</b>'

# ------------------------------------------------------------------ éléments de mise en page
class Banner(Flowable):
    """Bandeau d'étape : pastille orange numérotée, titre blanc, sous-titre bleu clair."""
    def __init__(self, num, title, sub):
        super().__init__(); self.num, self.title, self.sub = num, title, sub
    def wrap(self, aw, ah): return CW, 59.6 + 14
    def draw(self):
        c = self.canv; o = 14
        c.setFillColor(NAVY); c.roundRect(0, o, CW, 59.6, 9, fill=1, stroke=0)
        c.setFillColor(AMBER); c.circle(36.85, o + 29.8, 19.85, fill=1, stroke=0)
        c.setFillColor(NAVY); c.setFont('Poppins-Bold', 17 if len(str(self.num)) < 2 else 14.5)
        c.drawCentredString(36.85, o + 29.8 - 6, str(self.num))
        c.setFillColor(white); c.setFont('Poppins-Bold', 15); c.drawString(70.9, o + 29.8 + 2.5, self.title)
        c.setFillColor(LIGHTBLUE); c.setFont('Carlito', 10); c.drawString(70.9, o + 29.8 - 13, self.sub)

class NumItem(Flowable):
    """Ligne numérotée : pastille colorée + texte."""
    def __init__(self, n, text, color=BLUE, style=body):
        super().__init__(); self.n, self.text, self.color = n, text, color
        self.p = Paragraph(text, ParagraphStyle('ni', parent=style, spaceAfter=0))
    def wrap(self, aw, ah):
        self.w, self.ph = aw, self.p.wrap(aw - 25.5, ah)[1]
        self.h = max(self.ph, 18.2) + 5.8
        return aw, self.h
    def draw(self):
        c = self.canv
        top = self.h - 0.0
        self.p.drawOn(c, 25.5, self.h - self.ph - 0.0 - (max(self.ph, 18.2) - self.ph) / 2)
        c.setFillColor(self.color); c.circle(9.1, top - 9.1, 9.1, fill=1, stroke=0)
        c.setFillColor(white); c.setFont('Poppins-Bold', 8.4); c.drawCentredString(9.1, top - 9.1 - 3, str(self.n))

KINDS = {'note': ('BON À SAVOIR', AMBER_D, '#FEF3C7'), 'good': ('À RETENIR', GREEN, '#D1FAE5'),
         'tip': ('ASTUCE', BLUE, '#DBEAFE'), 'warn': ('ATTENTION', RED, '#FFE4E6')}

class Callout(Flowable):
    def __init__(self, kind, title, text):
        super().__init__(); self.kind, self.title = kind, title
        self.p = Paragraph(text, ParagraphStyle('co', fontName='Carlito', fontSize=10, leading=13.4, textColor=TEXT))
    def wrap(self, aw, ah):
        self.w = aw; ph = self.p.wrap(aw - 18, ah)[1]; self.ph = ph
        self.h = 8.6 + 15 + ph + 7
        return aw, self.h + 10
    def draw(self):
        label, col, bg = KINDS[self.kind]; c = self.canv
        c.setFillColor(HexColor(bg)); c.rect(0, 10, self.w, self.h, fill=1, stroke=0)
        c.setStrokeColor(col); c.setLineWidth(3); c.line(0, 10, 0, 10 + self.h)
        c.setFillColor(col); c.setFont('Poppins-Bold', 8)
        c.drawString(9, 10 + self.h - 8.6 - 6.5, label)
        c.setFillColor(TEXT); c.drawString(9 + pdfmetrics.stringWidth(label, 'Poppins-Bold', 8) + 4, 10 + self.h - 8.6 - 6.5, self.title)
        self.p.drawOn(c, 9, 10 + 7 + 0)

class TocLine(Flowable):
    def __init__(self, text, page):
        super().__init__(); self.text, self.page = text, page
    def wrap(self, aw, ah): return aw, 12.6     # resserré (17 lignes au programme depuis l'étape 16) pour tenir sur une page
    def draw(self):
        c = self.canv; c.setFillColor(TEXT); c.setFont('Carlito', 10.2); c.drawString(0, 3.1, self.text)
        c.drawRightString(CW, 3.1, str(self.page))
        x0 = pdfmetrics.stringWidth(self.text, 'Carlito', 10.2) + 5
        x1 = CW - pdfmetrics.stringWidth(str(self.page), 'Carlito', 10.2) - 5
        c.setFillColor(MUTED)
        x = x0
        while x < x1:
            c.drawString(x, 3.1, '.'); x += 5.1

class IconRow(Flowable):
    """Une ligne « bouton : à quoi il sert »."""
    def __init__(self, icon, name, desc, draw_icon=None):
        super().__init__(); self.icon, self.name, self.desc, self.draw_icon = icon, name, desc, draw_icon
        self.p = Paragraph(desc, ParagraphStyle('ir', fontName='Carlito', fontSize=9.6, leading=12, textColor=TEXT))
    def wrap(self, aw, ah):
        self.ph = self.p.wrap(aw - 148, ah)[1]; self.h = max(22.8, self.ph + 9); return aw, self.h
    def draw(self):
        c = self.canv; y0 = (self.h - 22.7) / 2
        if self.icon: c.drawImage(f'{ASSETS}/icon_{self.icon}.png', 0, y0, 22.7, 22.7, mask='auto')
        else: self.draw_icon(c, 0, y0, 22.7)
        c.setFillColor(TEXT); c.setFont('Carlito-Bold', 9.6); c.drawString(34, self.h / 2 - 3.4, self.name)
        self.p.drawOn(c, 138, (self.h - self.ph) / 2)
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(0, 0, CW, 0)

def icon_square(c, x, y, s, col):
    c.setFillColor(col); c.roundRect(x, y, s, s, 5, fill=1, stroke=0)
def icon_calendar(c, x, y, s):
    icon_square(c, x, y, s, GREEN); c.setStrokeColor(white); c.setFillColor(white); c.setLineWidth(1.3)
    c.roundRect(x + 4.5, y + 4.5, s - 9, s - 10, 1.5, fill=0, stroke=1)
    c.rect(x + 4.5, y + s - 11, s - 9, 3.6, fill=1, stroke=0)
    for i in range(3):
        for j in range(2):
            c.rect(x + 7 + i * 3.7, y + 6.3 + j * 3.2, 2, 1.8, fill=1, stroke=0)
def icon_admin(c, x, y, s):
    import math
    icon_square(c, x, y, s, HexColor('#C026D3')); c.setStrokeColor(white); c.setFillColor(white); c.setLineWidth(1.6)
    cx, cy = x + s / 2, y + s / 2
    c.circle(cx, cy, 4.2, fill=0, stroke=1)
    for k in range(8):
        a = k * math.pi / 4
        c.line(cx + 5.2 * math.cos(a), cy + 5.2 * math.sin(a), cx + 7.2 * math.cos(a), cy + 7.2 * math.sin(a))

def icon_user(c, x, y, s):
    icon_square(c, x, y, s, HexColor('#475569')); c.setFillColor(white)
    c.circle(x + s / 2, y + s * 0.62, 3.6, fill=1, stroke=0)
    p = c.beginPath(); p.moveTo(x + 5, y + 4.5); p.curveTo(x + 5, y + 11.5, x + s - 5, y + 11.5, x + s - 5, y + 4.5); p.close(); c.drawPath(p, fill=1, stroke=0)

# ---------- maquettes d'écran (même esprit que celles du guide : panneau sombre + repères numérotés)
class Panel(Flowable):
    W, H = CW, 100
    def wrap(self, aw, ah): return self.W, self.H
    def bg(self):
        c = self.canv; c.setFillColor(HexColor('#0F172A')); c.setStrokeColor(HexColor('#334155')); c.setLineWidth(0.8)
        c.roundRect(0, 0, self.W, self.H, 9, fill=1, stroke=1)
    def mark(self, n, x, y):
        c = self.canv; c.setFillColor(AMBER); c.circle(x, y, 6.2, fill=1, stroke=0)
        c.setFillColor(NAVY); c.setFont('Poppins-Bold', 7.4); c.drawCentredString(x, y - 2.6, str(n))
    def pill(self, x, y, w, h, text, fill, tcolor=white, size=7.6, bold=True):
        c = self.canv; c.setFillColor(fill); c.roundRect(x, y, w, h, h / 2.6, fill=1, stroke=0)
        c.setFillColor(tcolor); c.setFont('Poppins-Bold' if bold else 'Carlito', size); c.drawCentredString(x + w / 2, y + h / 2 - size * 0.34, text)
    def barchart(self, x, y):  # petite icône « graphique »
        c = self.canv; c.setFillColor(AMBER)
        for i, hh in enumerate((4, 7.5, 5.5)): c.rect(x + i * 3.6, y, 2.6, hh, fill=1, stroke=0)
    def tile(self, x, y, w, h, label, sel=False):
        c = self.canv; c.setFillColor(white); c.roundRect(x, y, w, h, 6, fill=1, stroke=0)
        if sel: c.setStrokeColor(AMBER); c.setLineWidth(2); c.roundRect(x, y, w, h, 6, fill=0, stroke=1)
        c.setFillColor(HexColor('#DB2777')); c.setFont('Poppins-Bold', 15); c.drawCentredString(x + w / 2, y + h / 2 - 1, label.split()[0])
        c.setFillColor(HexColor('#334155')); c.setFont('Poppins-Bold', 4.8); c.drawCentredString(x + w / 2, y + h / 2 - 9, 'DÉPARTEMENTALE')
        c.drawCentredString(x + w / 2, y + h / 2 - 14.5, 'FÉMININE')

class MockCalendar(Panel):
    H = 176
    def draw(self):
        c = self.canv; self.bg(); H = self.H
        c.setFillColor(AMBER); c.setFont('Poppins-Bold', 7.4); c.drawString(16, H - 17, 'ÉQUIPE')
        self.pill(self.W - 118, H - 23, 100, 14, 'Saison 2026-2027', HexColor('#1E293B'), white, 7, False)
        self.tile(16, H - 74, 70, 48, 'U13 F'); self.tile(94, H - 74, 70, 48, 'U15 F', sel=True)
        self.mark(1, 175, H - 50); self.mark(2, self.W - 126, H - 16)
        self.pill(16, H - 96, 70, 16, 'Phase 1', HexColor('#7C4A03'), white, 7.6)
        c.setStrokeColor(AMBER); c.setLineWidth(1.2); c.roundRect(16, H - 96, 70, 16, 4, fill=0, stroke=1)
        self.pill(94, H - 96, 70, 16, 'Phase 2', HexColor('#1E293B'), HexColor('#CBD5E1'), 7.6)
        self.mark(3, 175, H - 88)
        self.pill(16, H - 120, 230, 17, 'Calendrier & résultats', AMBER_D, white, 7.6)
        self.pill(250, H - 120, 227, 17, 'Classement', HexColor('#1E293B'), HexColor('#94A3B8'), 7.6)
        self.mark(4, self.W - 12, H - 112)
        c.setFillColor(HexColor('#111C33')); c.setStrokeColor(HexColor('#1E293B')); c.roundRect(16, 8, self.W - 32, 44, 7, fill=1, stroke=1)
        c.setFillColor(AMBER); c.setFont('Carlito-Bold', 9.5); c.drawRightString(190, 33, 'OLYMPIC SATHONAY')
        c.setFillColor(HexColor('#CBD5E1')); c.setFont('Carlito', 9.5); c.drawString(304, 33, 'ASUL LYON BASKET')
        for xx in (204, 280): c.setFillColor(white); c.circle(xx, 32, 9, fill=1, stroke=0)
        c.setFillColor(HexColor('#94A3B8')); c.setFont('Carlito', 6.8); c.drawCentredString(242, 44, '19 SEPT.')
        c.setFillColor(HexColor('#60A5FA')); c.setFont('Poppins-Bold', 11); c.drawCentredString(242, 30, '62 - 41')
        c.setFillColor(HexColor('#3B2A05')); c.setStrokeColor(AMBER); c.setLineWidth(0.9); c.roundRect(229, 11, 26, 13, 3.5, fill=1, stroke=1)
        self.barchart(236.5, 14)
        self.mark(5, 268, 17)

class MockAdmin(Panel):
    H = 168
    def draw(self):
        c = self.canv; self.bg()
        # bandeau d'icônes
        c.setFillColor(HexColor('#111C33')); c.roundRect(12, self.H - 40, self.W - 24, 28, 8, fill=1, stroke=0)
        self.pill(16, self.H - 36, 236, 20, 'Équipes & calendriers', AMBER_D, white, 7.6)
        self.pill(258, self.H - 36, 219, 20, 'Accès', HexColor('#111C33'), HexColor('#94A3B8'), 7.6)
        self.mark(1, 19, self.H - 7)
        # bouton de chargement
        self.pill(self.W - 190, self.H - 66, 174, 18, 'Charger les équipes depuis le cache', AMBER_D, white, 7)
        c.setFillColor(HexColor('#CBD5E1')); c.setFont('Carlito', 8.4); c.drawString(16, self.H - 60, 'Cache FFBB : 24 poule(s), mise à jour 14 nov.')
        self.mark(2, self.W - 200, self.H - 57)
        # vignettes
        for i, lab in enumerate(('U11 F', 'U13 F', 'U15 F')): self.tile(16 + i * 78, self.H - 138, 70, 62, lab, sel=(i == 2))
        c.setFillColor(HexColor('#94A3B8')); c.setFont('Carlito', 7); c.drawCentredString(51, 18, '2 phases'); c.drawCentredString(129, 18, '2 phases'); c.drawCentredString(207, 18, '2 phases')
        self.mark(3, 254, self.H - 107)
        # sous-onglets
        self.pill(284, self.H - 108, 94, 17, 'Effectif', AMBER_D, white, 7.4)
        self.pill(382, self.H - 108, 95, 17, 'Phases & calendrier', HexColor('#1E293B'), HexColor('#94A3B8'), 6.6)
        self.mark(4, 392, self.H - 124)
        self.pill(284, self.H - 142, 193, 17, 'Importer un PDF extranet FFBB', HexColor('#1E293B'), white, 7)
        self.mark(5, 276, self.H - 133)

class MockRoster(Panel):
    H = 118
    def draw(self):
        c = self.canv; self.bg()
        c.setFillColor(HexColor('#FDE68A')); c.setFont('Poppins-Bold', 7.6); c.drawString(14, self.H - 17, 'Aperçu : U11 FILLES · n° 1 · 2026-2027')
        # Données FICTIVES : prénoms seuls, n° de licence et dates inventés (aucune donnée réelle de licenciée).
        rows = [('', 'Léa', 'BC204518', '12/03/2016 (11 ans)', 'U11 F', 'joueur', None),
                ('', 'Jade', 'BC231907', '22/09/2016 (11 ans)', 'U11 F', 'joueur', None),
                ('', 'Manon', 'BC260341', '05/02/2018 (9 ans)', 'U11 F', 'joueur', 'Surclassement U11'),
                ('', 'Sophie', 'VT731205', '14/11/1984 (43 ans)', 'U11 F', 'encadrement', None)]
        for i, (ln, fn, lic, bd, tm, role, badge) in enumerate(rows):
            y = self.H - 40 - i * 21
            c.setFillColor(HexColor('#111C33')); c.roundRect(10, y - 4, self.W - 20, 19, 4, fill=1, stroke=0)
            c.setFillColor(AMBER); c.rect(16, y + 1, 7, 7, fill=1, stroke=0)
            c.setFillColor(NAVY); c.setFont('DejaVu', 5.5); c.drawString(16.8, y + 2, '✓')
            c.setFillColor(white); c.setFont('Carlito-Bold', 9); c.drawString(30, y + 4, fn); w = pdfmetrics.stringWidth(fn, 'Carlito-Bold', 9)
            if badge:
                bw = pdfmetrics.stringWidth(badge.upper(), 'Poppins-Bold', 5.2) + 8
                c.setFillColor(HexColor('#4A3508')); c.setStrokeColor(AMBER); c.setLineWidth(0.6)
                c.roundRect(36 + w, y + 2.2, bw, 9.5, 4.7, fill=1, stroke=1)
                c.setFillColor(HexColor('#FCD34D')); c.setFont('Poppins-Bold', 5.2); c.drawString(40 + w, y + 5.2, badge.upper())
            c.setFillColor(HexColor('#94A3B8')); c.setFont('Carlito', 8); c.drawString(236, y + 4, f'{lic} · {bd}')
            self.pill(372, y, 50, 13, tm, HexColor('#1E293B'), white, 7, False); self.pill(426, y, 54, 13, role, HexColor('#1E293B'), white, 7, False)
        self.mark(1, self.W - 8, self.H - 14); self.mark(2, 386 - 14, self.H - 40 + 10 + 11)

# ------------------------------------------------------------------ gabarit de page
class Doc(BaseDocTemplate):
    def __init__(self, path, first_page):
        super().__init__(path, pagesize=(PW, PH), leftMargin=LM, rightMargin=LM, topMargin=68, bottomMargin=52,
                         title="TeamStats - Mode d'emploi", author='Olympic Sathonay', subject='Suivi de match et statistiques')
        self.first = first_page
        frame = Frame(LM, 52, CW, PH - 52 - 68, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id='f')
        self.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=self.decor)])
    def decor(self, c, doc):
        c.saveState()
        c.setFillColor(NAVY); c.rect(0, PH - 36.9, PW, 36.9, fill=1, stroke=0)
        c.setFillColor(AMBER); c.rect(0, PH - 39.4, PW, 2.5, fill=1, stroke=0)
        c.setFillColor(white); c.setFont('Poppins-Bold', 9); c.drawString(LM, PH - 25, 'TeamStats')
        c.setFillColor(LIGHTBLUE); c.setFont('Poppins-Medium', 9); c.drawString(LM + 58, PH - 25, "Mode d'emploi")
        c.setFillColor(white); c.setFont('Poppins-Bold', 8); c.drawRightString(PW - LM + 0.3, PH - 25, 'OLYMPIC SATHONAY')
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(LM, PH - 802.2, PW - LM, PH - 802.2)
        c.setFillColor(MUTED); c.setFont('Carlito', 9); c.drawCentredString(PW / 2, PH - 816.4, f'Page {self.first + doc.page - 1}')
        c.restoreState()

def build(story, first_page):
    buf = io.BytesIO(); Doc(buf, first_page).build(story); buf.seek(0); return PdfReader(buf)

def P(text, style=body): return Paragraph(text, style)
def H2(text): return Paragraph(text, h2)

# ================================================================== PAGE 1 : accueil + programme
def page_accueil(pg_vocal=14, pg_temps=16, pg_partage=17, pg_annexe_a=18, pg_annexe_b=19):
    s = [P('Bienvenue', ParagraphStyle('h1a', parent=h1, spaceAfter=3)),
         P("TeamStats suit un match de basket en direct, joueuse par joueuse, partage les statistiques en PDF et donne le calendrier, "
           f"les résultats et le classement de vos équipes. Ce guide explique tout, pas à pas, {b('sans notion technique')}."), H2('Au programme')]
    toc = [("Étape 1 · Créer l'équipe et les joueuses", 2), ('Étape 2 · Préparer le match', 3), ('Étape 3 · Choisir les joueuses du match', 4),
           ('Étape 4 · Démarrer le match', 4), ("Étape 5 · L'écran Direct", 5), ('Étape 6 · Saisir les actions', 6),
           ('Étape 7 · Changements, périodes et prolongations', 7), ('Étape 8 · Enregistrer et retrouver un match', 8),
           ('Étape 9 · Statistiques et rapports PDF', 9), ("Étape 10 · Utiliser l'appli sans réseau", 10),
           ('Étape 11 · Historique, aide-mémoire et dépannage', 11), ('Étape 12 · Le menu Calendrier', 12),
           ('Étape 13 · Mon compte et nouveautés', 13), ('Étape 14 · La commande vocale', pg_vocal), ('Étape 15 · Le temps de jeu et le chrono', pg_temps),
           ('Étape 16 · Deux personnes sur le même match', pg_partage),
           ('Annexe A · Module administrateur', pg_annexe_a), ('Annexe B · Récapitulatif des commandes vocales', pg_annexe_b)]
    s += [TocLine(t, p) for t, p in toc]
    s += [H2('Les boutons à connaître'), P('En haut à droite, une petite barre donne accès à tout, sur chaque écran :', ParagraphStyle('x', parent=body, spaceAfter=4))]
    s += [IconRow('config', 'Configuration', "Créer l'équipe, préparer le match, choisir les joueuses."),
          IconRow('direct', 'Direct', "L'écran du match : chrono, score, saisie des actions."),
          IconRow('stats', 'Statistiques', 'Le tableau des joueuses et les exports PDF.'),
          IconRow('histo', 'Historique', "Toutes les actions dans l'ordre, pour corriger."),
          IconRow(None, 'Calendrier', "Calendrier, résultats et classement des équipes ; stats PDF d'un match.", icon_calendar),
          IconRow(None, 'Administration', "Réservé aux admin : équipes, calendriers, effectifs et accès des coachs.", icon_admin),
          IconRow('save', 'Enregistrer', 'Envoie le match et les statistiques dans la base.'),
          IconRow(None, 'Mon compte', "Mot de passe ; pour un admin : tester ce que voit un coach.", icon_user)]
    s += [Spacer(1, 0),
          Callout('note', 'Connexion', "À l'ouverture, saisissez l'e-mail et le mot de passe donnés par l'administrateur. Quatre profils : "
                  f"{b('superadmin')} (accès illimité), {b('admin')} (toutes les équipes ; gère le club et les comptes), {b('coach')} "
                  f"(modifie les équipes qui lui sont ouvertes) et {b('consultant')} (les lit seulement) : voir l'annexe A. Déconnexion en haut à gauche. "
                  "Sans réseau, l'appli s'ouvre avec le dernier compte connecté."),
          Callout('good', 'Pensez à enregistrer.', "Le match est gardé sur l'appareil même si la page se ferme, mais seul le bouton Enregistrer (la disquette) "
                  "l'envoie dans la base. Sans réseau, il le met de côté et l'envoie dès le retour de la connexion (étape 10).")]
    return s

# ================================================================== ÉTAPE 12 : menu Calendrier
def page_calendrier():
    s = [Banner(12, 'Le menu Calendrier', 'Équipes, calendrier, résultats, classement et statistiques'),
         P(f"Le bouton {b('Calendrier')} (l'agenda vert, en haut à droite) affiche le calendrier officiel de vos équipes. "
           f"{b('Chaque personne ne voit que ses équipes')} : un coach celles qui lui sont ouvertes, un admin toutes."),
         MockCalendar(), P("Menu Calendrier : choix de l'équipe, de la saison et de la phase", caption),
         NumItem(1, f"{b('Touchez l’image de l’équipe')} (U13 F, U15 F…), la même que sur le site de la FFBB. Avec une seule équipe, elle est déjà choisie ; votre dernier choix est retenu."),
         NumItem(2, f"{b('La saison')} : celle en cours par défaut ; la liste permet de revoir une saison passée (« historique », en lecture seule)."),
         NumItem(3, f"{b('La phase')} : {chip('Phase 1', 'yellow')} {chip('Phase 2', 'gray')} {chip('Coupe', 'gray')}… La phase en cours s'ouvre seule. "
                    f"La compétition et la poule sont rappelées dessous (ex. Départementale féminine U15 - Division 2 · Poule C). Une coupe est une seule entrée {chip('Coupe', 'gray')}, rangée par tours (1er tour, 2e tour…)."),
         NumItem(4, f"{b('Deux onglets')} : {chip('Calendrier & résultats', 'yellow')} et {chip('Classement', 'gray')}. Au-dessus, {chip('Calendrier', 'yellow')} / {chip('Effectif', 'gray')} : l'effectif de l'équipe, en lecture seule."),
         NumItem(5, f"{b('L’icône graphique')} apparaît sous le score d'un match dont les statistiques sont saisies : un toucher télécharge le PDF du match."),
         H2('Calendrier & résultats'),
         P(f"{chip('Notre équipe', 'yellow')} / {chip('Toute la poule', 'gray')} ; {chip('Une journée', 'yellow')} (avec les flèches ‹ ›) / {chip('Toutes', 'gray')}. "
           f"Notre score est en {b('bleu')} pour une victoire, {b('vert')} pour un nul, {b('rouge')} pour une défaite ; les matchs à venir donnent l'heure et le lieu."),
         H2('Classement'),
         P(f"Place, équipe, points, matchs joués, victoires-défaites, points marqués (BP) et encaissés (BC), différence et {b('forme')} (5 derniers résultats). "
           "Notre équipe est en doré. Sans classement officiel, il est calculé d'après les résultats (victoire 2 points, défaite 1) et une mention l'indique."),
         H2("Les statistiques d'un match en PDF"),
         P(f"L'icône graphique télécharge le PDF des statistiques du match, {b('identique à celui de l’étape 9')} (vue « Match complet »). "
           "Le match que vous seriez en train de saisir n'est pas touché. Pas d'icône : aucune statistique saisie, match d'une autre équipe, ou pas de réseau.")]
    return s

# ================================================================== ÉTAPE 13 : mon compte et nouveautés
def _table(rows, widths, head=('', '')):
    t = Table([[Paragraph(h, ParagraphStyle('th', fontName='Poppins-Bold', fontSize=8.5, textColor=white)) for h in head]] + rows, colWidths=widths)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#F1F5F9')]), ('LINEBELOW', (0, 0), (-1, -1), 0.5, LINE),
                           ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('LEFTPADDING', (0, 0), (-1, -1), 7)]))
    return t

def page_nouveautes():
    defaults = _table([[Paragraph(a, cellb), Paragraph(b_, cell), Paragraph(c_, cell)] for a, b_, c_ in (
        ('U9 et moins', '6 périodes de 4 min', 'non (le nul est possible)'),
        ('U11', '8 périodes de 4 min', 'non (le nul est possible)'),
        ('U13', '4 périodes de 8 min', 'oui, 5 min'),
        ('U15 et plus, seniors', '4 périodes de 10 min', 'oui, 5 min'))], [120, 190, CW - 310], ('Catégorie', 'Périodes', 'Prolongation'))
    s = [Banner(13, 'Mon compte et nouveautés', 'Mot de passe, tester un profil, périodes par défaut, saisons clôturées'),
         H2('Mon compte (le bonhomme gris)'),
         NumItem(1, f"{b('Changer mon mot de passe')} : touchez le bouton {chip('Mon compte', 'gray')} (le bonhomme gris, à côté de la déconnexion, visible aussi sur téléphone), saisissez le nouveau mot de passe deux fois, puis "
                    f"{chip('Enregistrer le mot de passe', 'yellow')}. L'appli n'impose aucune règle ; le serveur refuse seulement moins de 6 caractères."),
         NumItem(2, f"{b('Se connecter en tant que… (admin et superadmin)')} : juste après la connexion, une fenêtre propose {chip('Continuer en admin', 'green')} ou de {b('tester un coach ou un consultant')}, "
                    "sans connaître son mot de passe. Vous avez alors exactement ses équipes et ses droits : c'est le moyen de vérifier ce qu'il voit. Un bandeau bleu propose "
                    f"{chip('Revenir à mon compte', 'blue')}. Le même choix est dans « Mon compte »."),
         Callout('warn', 'Pendant un test', "Ce que vous enregistrez est enregistré pour de vrai, au nom de ce compte. Un seul onglet du navigateur, et revenez à votre compte avant de fermer la page."),
         H2('Périodes par défaut selon la catégorie'),
         P("Dès que vous choisissez l'équipe (ou un match du calendrier), le nombre et la durée des périodes se règlent selon la catégorie. Vous pouvez les modifier ensuite ; rien ne change si un match est déjà en cours."),
         defaults, Spacer(1, 6),
         P(f"Le champ {chip('Heure', 'gray')} de la configuration se remplit tout seul depuis le calendrier ; la {b('date et l’heure du match')} s'affichent en petit au-dessus du score du Direct, pour retrouver ce que vous avez préparé."),
         H2('Saisons terminées : lecture seule'),
         P(f"Tout ce qui date d'{b('avant le 1er septembre de la saison en cours')} est verrouillé, pour tout le monde (admin et superadmin compris) : matchs, statistiques, équipes, joueuses, calendriers et effectifs. "
           "La consultation, l'historique et le PDF des statistiques restent possibles."),
         NumItem(1, f"Dans la liste {chip('JOUÉ', 'green')} de la loupe, un match ancien porte un {b('cadenas')} et n'a plus de corbeille ; à son ouverture, un bandeau indique « lecture seule » et la disquette explique que l'enregistrement est refusé."),
         NumItem(2, "Dans Calendrier et Administration, les saisons passées sont marquées « historique ». Une correction exceptionnelle ne peut se faire que par le superadmin, directement dans la base (annexe A).")]
    return s


# ================================================================== ÉTAPE 14 : commande vocale
class MockVoice(Panel):
    """Bandeau vocal : mode DIRECT (haut) et mode CONFIGURATION avec ses six boutons (bas)."""
    H = 168
    def draw(self):
        c = self.canv; self.bg(); H = self.H; W = self.W
        slate = HexColor('#1E293B'); grey = HexColor('#94A3B8')
        c.setFillColor(AMBER); c.setFont('Poppins-Bold', 6.8); c.drawString(14, H - 14, 'MODE DIRECT (par défaut)')
        self.pill(14, H - 44, 168, 24, 'COMMANDE VOCALE : ACTIVE', GREEN, white, 7.2)
        self.pill(190, H - 42, 124, 20, 'TIR 2PTS RÉUSSI · Léa', HexColor('#064E3B'), HexColor('#6EE7B7'), 7)
        self.pill(W - 170, H - 42, 74, 20, 'DIRECT', GREEN, white, 7.4)
        self.pill(W - 92, H - 42, 80, 20, 'CONFIGURATION', slate, grey, 6.2)
        self.mark(1, 22, H - 52); self.mark(2, 196, H - 50); self.mark(3, W - 176, H - 50)
        c.setStrokeColor(HexColor('#334155')); c.setLineWidth(0.6); c.line(14, H - 70, W - 14, H - 70)
        c.setFillColor(AMBER); c.setFont('Poppins-Bold', 6.8); c.drawString(14, H - 84, 'MODE CONFIGURATION')
        self.pill(14, H - 116, 168, 24, 'COMMANDE VOCALE : COUPÉE', slate, HexColor('#CBD5E1'), 7.2)
        self.pill(W - 170, H - 114, 74, 20, 'DIRECT', slate, grey, 7.4)
        self.pill(W - 92, H - 114, 80, 20, 'CONFIGURATION', HexColor('#64748B'), white, 6.2)
        items = [('＋ Nouveau', 54, slate), ('Didacticiel', 58, HexColor('#4338CA')), ('Calibrer', 46, HexColor('#4338CA')), ('Moteur', 42, slate), ('Prénoms', 48, slate), ('Aide', 34, slate)]
        x = W - 14 - sum(w for _, w, _ in items) - 4 * (len(items) - 1)
        for lab, w, col in items:
            self.pill(x, H - 148, w, 16, lab, col, white, 6.4); x += w + 4
        self.mark(4, W - 14 - 6, H - 152)


def page_vocal():
    faq = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in (
        ('2 bips à chaque phrase, rien ne se passe', "Le micro entend mal : rapprochez-le (casque), parlez un peu plus lentement, ou lancez Calibrer (CONFIGURATION). Si un prénom n'est jamais compris, ajoutez sa prononciation avec Prénoms (ex. « Candy », « kandis »)."),
        ('2 bips sur « deux points » tout seul', "En mode DIRECT l'appli ne pose aucune question : il manque la joueuse. Redites la phrase entière (« Léa deux points ») ou sélectionnez d'abord la joueuse."),
        ('« Untel n\'est pas sur le terrain »', "L'action est refusée comme avec les boutons. Faites d'abord le changement, puis répétez l'action."),
        ('Rien ne se passe, pas même un bip', "Le bouton doit être vert (ACTIVE). Vérifiez le réseau (ou le moteur hors ligne préparé), l'autorisation du micro pour le site, et que le navigateur est Chrome."),
        ('Une mauvaise action est enregistrée', "Dites « annule la dernière commande » (ou « annule dernière action » suivi du prénom). Un changement ne s'annule pas : on en refait un."),
        ("Je veux revoir les traces, les questions ou la voix", "Passez en CONFIGURATION : diagnostic, apprentissage des mots, retour vocal et questions y sont disponibles. Repassez en DIRECT pour jouer."),
        ('« Les numéros ne se changent qu\'avant le match »', "Dès qu'une action, un point ou un changement de période est enregistré, ou que le chrono tourne, les numéros se règlent dans Configuration → Feuille de Match (N° match)."))],
        [150, CW - 150], ('Situation', 'Que faire ?'))
    steps = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in (
        ('1 · Activer la voix', "Touchez COMMANDE VOCALE, autorisez le micro. Les deux sons sont expliqués (boutons pour les écouter) ; un essai à 2 bips, un essai à 1 bip."),
        ('2 · Numéros', "Quatre joueuses sont restées au numéro 0, comme dans la vraie vie : « contrôle numéros joueuses » les nomme, puis vous leur donnez un numéro (quatre façons de le dire), puis un nouveau contrôle."),
        ('3 · Les cinq de départ', "Le terrain est vide : annoncez les cinq joueuses, par prénom ou par numéro."),
        ("4 · Coup d'envoi", "« démarrer le match »."),
        ('5 · Premières actions', "Six actions au hasard, sur des joueuses au hasard : une fois par le prénom, une fois par le numéro."),
        ('6 · Temps mort', "Arrêt du chrono, remise du chrono à une valeur, trois façons de faire un changement, la fenêtre de changement."),
        ('7 · Reprise du jeu', "« reprise du jeu »."),
        ('8 · Suite du match', "Les neuf autres actions (au total les 15 actions de joueuse), numéros refusés après le coup d'envoi, sélection d'une joueuse."),
        ('9 à 12', "Lancers francs · score adverse · annulation · questions (score, terrain, fautes).") )],
        [150, CW - 150], ('Phase', 'Ce que vous faites'))
    return [Banner(14, 'La commande vocale', "Saisir à la voix, sans quitter le match des yeux"),
         P(f"Dans l'écran {b('Direct')}, le bandeau {b('Commande vocale')} permet de tout saisir à la voix : numéros, cinq de départ, chrono, tirs, rebonds, fautes, lancers francs, changements, score adverse. "
           f"{b('Les boutons restent toujours là')} et font tout, comme avant : la voix est un plus, jamais une obligation. Annexe B : toutes les phrases reconnues."),
         H2('Mettre en route'),
         NumItem(1, f"Touchez {chip('COMMANDE VOCALE : COUPÉE', 'gray')} : il devient {chip('ACTIVE', 'green')}. Le mode est coupé à chaque ouverture de l'appli. Autorisez le micro la première fois. Un casque-micro est recommandé."),
         NumItem(2, f"Il faut {b('Chrome')}. En ligne, le navigateur envoie l'audio à son fournisseur pour le comprendre ; {b('hors ligne')}, la reconnaissance se fait sur l'appareil si vous l'avez préparée une fois avec du réseau (bouton {chip('Moteur', 'blue')}, dans CONFIGURATION)."),
         NumItem(3, f"Parlez naturellement, {b('une commande par phrase')}. Dès la fin de la phrase l'action est faite, en général en moins d'une seconde ; le résultat s'écrit dans le bandeau (ex. « TIR 2PTS RÉUSSI · Léa »)."),
         H2('L\'interrupteur DIRECT / CONFIGURATION'),
         MockVoice(), P("Le bandeau vocal : mode DIRECT (haut) et mode CONFIGURATION (bas)", caption),
         NumItem(1, f"{b('Bouton vocal')} : vert = la voix écoute, gris = coupée."),
         NumItem(2, f"{b('Résultat')} : ce que l'appli a compris, ou ce qui manque quand elle refuse (« Quelle joueuse ? »)."),
         NumItem(3, f"{b('L’interrupteur')} : {chip('DIRECT', 'green')} (vert, choisi à chaque ouverture) pour jouer ; {chip('CONFIGURATION', 'gray')} pour régler. Rien d'autre n'est affiché en DIRECT : pas de trace, pas de diagnostic."),
         NumItem(4, f"{b('Les six menus de CONFIGURATION')}, toujours tous visibles : {chip('＋ Nouveau', 'gray')} (repartir de zéro), {chip('Didacticiel', 'blue')} (toujours accessible, même avec un match ouvert), {chip('Calibrer', 'blue')}, {chip('Moteur', 'gray')}, {chip('Prénoms', 'gray')}, {chip('Aide', 'gray')}. En CONFIGURATION s'ajoutent le diagnostic, l'apprentissage des mots mal compris, le retour vocal et les questions."),
         Callout('good', 'En DIRECT, tout va au plus court', "L'appli écoute et agit. Elle ne parle jamais (parler coupe le micro pendant 1 à 2 secondes) et ne pose aucune question en attente : une phrase incomplète est refusée tout de suite, et la suivante repart de zéro. Si deux prénoms se ressemblent exactement, elle prend le premier et l'affiche ; « annule » corrige."),
         H2('Les deux sons à retenir'),
         _table([[Paragraph("1 bip aigu", cellb), Paragraph(f"{b('Commande effectuée')} ✓ : l'action est enregistrée (ou la vérification est bonne).", cell)],
                 [Paragraph("2 bips graves", cellb), Paragraph(f"{b('Commande non reconnue ou impossible')} ✗ : rien n'a été fait. Lisez le bandeau pour savoir pourquoi, puis redites la phrase en entier : prénom ou numéro mal compris, joueuse manquante, joueuse pas sur le terrain, chrono déjà lancé, joueuse à 5 fautes, numéros demandés après le coup d'envoi, doublons de numéros, secondes au-delà de 59.", cell)]],
                [100, CW - 100], ('Son', 'Signification')),
         H2('Comment parler'),
         NumItem(1, f"{b('Désigner une joueuse')} : par son {b('prénom')} ou son {b('numéro')} (« la 5 », « le 12 », « numéro 5 »). L'ordre est libre : « Léa deux points » ou « deux points pour Léa ». Les petits mots (de, du, pour, la, le, et…) sont ignorés."),
         NumItem(2, f"{b('Sélectionner')} : « sélectionne Manon » allume sa carte. La joueuse sélectionnée (ou touchée à l'écran) devient la joueuse par défaut : « deux points », « interception » suffisent."),
         NumItem(3, f"{b('Sans validation')} : les actions sont enregistrées tout de suite. Pour corriger : {b('« annule la dernière commande »')} ou {b('« annule dernière action »')} suivi du prénom."),
         CondPageBreak(160),
         H2("Avant le coup d'envoi (commandes valables uniquement avant le match)"),
         NumItem(1, f"{b('Donner un numéro de maillot')} : « {b('Candice a le numéro 5')} ». Autres façons : « Candice prend le 5 », « Candice porte le numéro 5 », « Candice a le 5 ». Le numéro est mis à jour dans la {b('feuille de match')} (N° match) et sur la joueuse du match. Plusieurs joueuses dans la même phrase sont possibles. Si une autre joueuse a déjà ce numéro, l'appli prévient (« Attention : Laura a aussi le 7 »)."),
         NumItem(2, f"{b('Contrôler les numéros')} : « {b('contrôle numéros joueuses')} » (ou « vérifie les numéros »). Tous différents : 1 bip et « Numéros tous différents ». Sinon 2 bips et les doublons sont nommés (« Numéro 0 : Alice, Aliya, Annaelle » : les joueuses restées au numéro 0 par défaut)."),
         NumItem(3, f"{b('Annoncer les cinq de départ')} (terrain vide) : « sur le terrain on a Léa, Jade, Inès, Lina et Zoé », ou par numéros (« sur le terrain on a 4, 7, 9, 12, 15 »). Une courte pause est permise : l'appli attend les prénoms manquants. Rien n'est inscrit dans l'historique."),
         Callout('note', 'Après le coup d\'envoi', "Dès qu'une action, un point, un changement de période est enregistré, ou que le chrono tourne, les deux commandes de numéros sont refusées (2 bips) : on ne change pas un maillot en cours de match. Corrigez alors dans Configuration → Feuille de Match."),
         H2('Pendant le match'),
         NumItem(1, f"{b('Chrono')} : « démarrer chrono », « démarrer le match », « reprise du jeu » ; « arrêt chrono », « temps mort ». {b('Remettre le chrono à une valeur')}, à tout moment : « {b('mettre chrono à 8 minutes et 30 secondes')} » (ou « mets le chrono à 5 minutes »). Le chrono s'arrête : dites « démarrer chrono » pour repartir."),
         NumItem(2, f"{b('Actions de joueuse')} : tirs à 2 et 3 points réussis ou manqués, rebonds offensif et défensif, passe décisive, interception, perte de balle, contre, contre subi, fautes personnelle, subie, technique, antisportive et disqualifiante (annexe B)."),
         NumItem(3, f"{b('Lancers francs')} : « lancer franc Nora » ouvre la série, visible à l'écran (LF 1, LF 2, LF 3) ; « premier réussi », « deuxième raté », « terminé » ; ou tout en une phrase : « Camille un sur trois »."),
         NumItem(4, f"{b('Changements')} : « remplacement Léa par Zoé », « sortie de Léa entrée de Zoé », ou « sur le terrain on a… » avec les cinq. Ils sont {b('enregistrés tout de suite')} (pas de « oui » à dire). « Afficher changement » ouvre la fenêtre de choix à l'écran, « fermer » la ferme."),
         NumItem(5, f"{b('Score adverse')} : « adversaire deux points », « adversaire trois points », « adversaire moins un »."),
         NumItem(6, f"{b('Questions')} : « score », « qui est sur le terrain », « combien de fautes Léa », « fautes équipe ». En DIRECT la réponse s'écrit dans le bandeau ; en CONFIGURATION elle est aussi dite à voix haute."),
         CondPageBreak(200),
         H2('Le didacticiel : apprendre sur un match de démonstration'),
         P(f"{chip('CONFIGURATION', 'gray')} puis {chip('Didacticiel', 'blue')} : un {b('match fictif')} (SATHONAY contre une équipe au hasard, 10 joueuses au hasard) se lance en mode DIRECT. "
           f"Toujours accessible, même quand un vrai match est ouvert : il est {b('gardé sur l’appareil et revient tel quel')} quand vous quittez le didacticiel. Rien du match fictif n'est enregistré."),
         NumItem(1, f"{b('Une fenêtre à 80 % d’opacité')} : le match reste visible dessous. Si elle gêne, {b('faites-la glisser par son en-tête')} (doigt ou souris) ; « Réduire » la range en pastille."),
         NumItem(2, "Chaque étape donne la phrase à dire, d'autres façons de la dire (« au choix »), et ce qui doit se passer. Elle passe au vert dès que l'effet est visible, puis la suivante arrive. « Passer » et « Précédent » permettent de sauter ou de revenir."),
         NumItem(3, "Le parcours suit un vrai match, dans l'ordre, et couvre toutes les actions possibles :"),
         steps, Spacer(1, 6),
         H2('Aller plus vite, ou régler la reconnaissance'),
         NumItem(1, f"{b('Calibrer')} (CONFIGURATION) : fait lire toutes les phrases (environ 6 minutes, casque sur la tête). L'appli apprend les prénoms et mots mal compris et les {b('enregistre sur votre compte')} : ils suivent sur tous vos appareils."),
         NumItem(2, f"{b('Prénoms')} : ajoute la prononciation d'un prénom difficile. {b('Moteur')} : choisit la reconnaissance en ligne ou sur l'appareil (hors ligne). {b('Aide')} : liste des commandes avec exemples."),
         NumItem(3, "Phrases courtes, une commande à la fois ; un prénom plus facile à entendre vaut un surnom appris une fois pour toutes."),
         Callout('tip', 'Contrôle sans parler', "Les boutons de l'écran restent disponibles à tout moment : un geste de la main corrige tout ce que la voix aurait mal compris."),
         CondPageBreak(200), H2('Si ça ne marche pas'), faq]


def page_temps():
    ex = _table([[Paragraph(a, cellb), Paragraph(b_, cell), Paragraph(c_, cell)] for a, b_, c_ in (
        ('Léa', '20:00', '16:40'), ('Jade', '15:00', '12:30'), ('Inès', '12:00', '10:00'), ('Lina', '6:00', '5:00'), ('Zoé', '7:00', '5:50'))],
        [110, 180, CW - 290], ('Joueuse', 'Temps cumulé par les chronos (période de 10 min)', 'Temps retenu'))
    return [Banner(15, 'Le temps de jeu et le chrono', 'Comment il est compté, plafonné et corrigé'),
         H2('Comment le temps de jeu est compté'),
         P(f"Le temps de jeu d'une joueuse {b('s’additionne seulement quand le chrono tourne')}, pendant qu'elle est sur le terrain, période par période. "
           "Lancez le chrono au coup d'envoi et mettez-le en pause à chaque arrêt de jeu ; à la voix : « démarrer le match », « arrêt chrono », « reprise du jeu »."),
         H2('Le plafond : cinq joueuses × la durée de la période'),
         P(f"Sur le terrain il y a {b('5 joueuses')} : sur une période de 10 minutes, le temps de jeu de toutes les joueuses réunies ne peut donc pas dépasser {b('50 minutes')} (5 × 10). "
           f"En prolongation (5 minutes) : {b('25 minutes')}. Comme on peut rejouer avec le chrono (le remettre à une valeur, recommencer une période, corriger un oubli), le total cumulé peut dépasser ce plafond. "
           f"Dans ce cas l'appli {b('proratise')} : le temps de chaque joueuse est réduit dans la même proportion, pour retomber {b('exactement')} sur le plafond (en secondes entières)."),
         Callout('good', 'Exemple', "Période de 10 minutes, plafond 50:00. Les chronos ont cumulé 60:00 (20+15+12+6+7). Chaque temps est multiplié par 50/60 : Léa 20:00 devient 16:40, Jade 15:00 devient 12:30, et ainsi de suite ; la somme fait exactement 50:00."),
         ex, Spacer(1, 6),
         NumItem(1, f"{b('Sous le plafond, rien ne change')} : une période où l'on n'a pas tout chronométré (par exemple 38 minutes pour 5 joueuses) garde ses temps réels."),
         NumItem(2, f"{b('Partout le même temps')} : écran Direct, écran Statistiques, PDF, enregistrement dans la base, et PDF d'un match déjà enregistré (anciens matchs plafonnés à l'affichage). Chaque période a son plafond ; le total d'une joueuse est la somme de ses périodes."),
         H2('Remettre le chrono à la bonne valeur'),
         NumItem(1, f"{b('À la main')} : double-clic sur les chiffres du chrono, tapez le temps au format mm:ss (ex. 05:30), validez."),
         NumItem(2, f"{b('À la voix')}, à tout moment du match : « {b('mettre chrono à 5 minutes et 30 secondes')} » ; « mets le chrono à 8 minutes » (secondes à zéro) ; « chrono à 45 secondes ». Secondes de 0 à 59, sinon 2 bips."),
         NumItem(3, "Le chrono s'arrête après la remise à l'heure : dites « démarrer chrono » (ou « reprise du jeu ») pour repartir. Avant le coup d'envoi, annoncez d'abord les cinq de départ, puis réglez le chrono."),
         ]


# ================================================================== ÉTAPE 16 : deux personnes sur le même match
def page_partage():
    cadenas = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in (
        ('Petit cadenas ouvert, devant la date', 'Personne ne saisit ce match : vous pouvez le prendre.'),
        (f"Cadenas fermé, {chip('Camille · actif il y a 12 min', 'yellow')}", "Camille saisit ce match en ce moment (dernière action il y a 12 minutes)."),
        (f"Cadenas fermé, {chip('vous (cet appareil)', 'green')}", "C'est vous, sur cette tablette ou ce téléphone."),
        (f"Cadenas fermé, {chip('vous (autre appareil)', 'blue')}", "C'est vous, mais depuis un autre appareil : il compte comme une autre personne."),
        (f"Cadenas fermé, {chip('inactif depuis 5 h', 'gray')}", "Plus aucune activité depuis 4 heures : le cadenas est considéré comme abandonné. Vous le prenez d'un geste, sans confirmation."))],
        [190, CW - 190], ('Ce que vous voyez dans la liste', 'Ce que cela veut dire'))
    return [Banner(16, 'Deux personnes sur le même match', 'Enregistrement protégé, conflits et cadenas'),
         P(f"Quand deux personnes saisissent ou enregistrent {b('le même match')} (par exemple un test, puis le vrai), l'appli empêche qu'une saisie en {b('écrase')} une autre sans prévenir. "
           "Trois protections travaillent ensemble ; la première est invisible, les deux autres s'affichent à l'écran."),
         H2("1 · Un enregistrement qui ne se mélange pas"),
         P(f"Enregistrer se fait en {b('une seule opération')} : le match, son historique et ses statistiques sont écrits ensemble, ou pas du tout. "
           "Deux enregistrements au même instant ne peuvent plus laisser de doublons. Chaque match garde un numéro de version, le nom de la dernière personne qui l'a enregistré et l'heure."),
         Callout('note', 'Qui a enregistré en dernier ?', f"Dans la liste {chip('JOUÉ', 'green')} de la loupe, chaque match indique « dernier enregistrement par Prénom le … à … ». "
                 "Le nom est celui du profil, sinon la partie de l'adresse e-mail avant le @."),
         H2("2 · Si quelqu'un a enregistré entre-temps"),
         NumItem(1, f"L'appli retient la version du match que vous avez ouverte. Si quelqu'un d'autre enregistre ensuite, {b('rien n’est écrasé')} : à votre enregistrement, une fenêtre vous dit « Prénom a enregistré à 14:32 »."),
         NumItem(2, f"Trois choix : {chip('Remplacer par ma version', 'red')} (il faut écrire le mot {b('confirmation')}, comme pour un match déjà joué), "
                    f"{chip('Garder la leur', 'blue')} (ouvre leur version et abandonne la vôtre, après confirmation), ou {chip('Annuler', 'gray')}."),
         NumItem(3, f"{b('Sans réseau')} : un match mis de côté qui se retrouve en conflit n'est pas renvoyé tout seul. Un bandeau orange {b('« … en conflit d’enregistrement »')} reste affiché jusqu'à votre décision (étape 10)."),
         H2("3 · Le cadenas : un seul saisisseur à la fois"),
         P(f"Quand vous choisissez un match dans la loupe ({chip('À VENIR', 'blue')} ou {chip('JOUÉ', 'green')}), l'appli pose un cadenas à votre nom. "
           f"Les autres le voient {b('écrit sur la ligne du match')}, avant même de l'ouvrir (la liste se rafraîchit toute seule)."),
         cadenas, Spacer(1, 6),
         NumItem(1, f"{b('Prendre la main')} : si quelqu'un saisit déjà le match, une fenêtre donne son nom et sa dernière activité. Pour continuer, écrivez {b('confirmation')} (un administrateur n'a pas à l'écrire)."),
         NumItem(2, f"{b('Celui qui est repris est prévenu')} : un bandeau « Camille a repris la saisie de ce match à 15:02 » apparaît dans la minute et demie qui suit, avec {chip('Reprendre la main', 'yellow')} ou {chip('Ignorer', 'gray')}. "
                    f"À son prochain enregistrement, une fenêtre « Votre saisie a été reprise » demande confirmation avant d'écraser. Sa saisie reste sur son appareil."),
         NumItem(3, f"{b('Libérer')} : tant que vous saisissez, la ligne « Vous saisissez ce match » apparaît sous le titre, avec le bouton {chip('Libérer', 'green')}. {chip('Nouveau match', 'gray')} rend aussi le cadenas. "
                    f"Si vous fermez l'appli sans libérer, le cadenas s'ouvre seul après 4 heures sans activité."),
         Callout('good', 'Un test qui ne fait pas foi', "Si vous avez commencé en test et qu'un autre prend le vrai match, appuyez sur « Libérer » (ou « Nouveau match ») : plus personne n'est bloqué. "
                 "Si c'est l'autre qui a commencé, vous le voyez sur la ligne du match avant de décider de prendre la main."),
         Callout('note', '', f"Le cadenas est un {b('confort')} : la vraie sécurité reste la comparaison de version à l'enregistrement (§ 2), qui protège aussi sans réseau. "
                 "Sans réseau ou sans le script SQL de l'installation (annexe A), il n'y a simplement pas de cadenas. Un match d'une saison clôturée est en lecture seule : il n'en prend pas. "
                 "Un compte consultant ne pose jamais de cadenas.")]

# ================================================================== ANNEXE B : récapitulatif des commandes vocales
def page_annexe_voix():
    def sec(title, rows, head=('Action', 'Phrases reconnues')):
        data = [[Paragraph(a, cellb), Paragraph('<br/>'.join('– ' + x for x in ph), cell)] for a, ph in rows]
        return [CondPageBreak(120), H2(title), _table(data, [135, CW - 135], head)]
    s = [Banner('B', 'Récapitulatif des commandes vocales', 'Toutes les phrases reconnues, par thème'),
         P(f"Les prénoms et numéros ci-dessous sont des {b('exemples')} : remplacez-les par ceux de vos joueuses. Une joueuse se désigne par son {b('prénom')} ou son {b('numéro')} "
           "(« la 5 », « le 12 », « numéro 5 », « cinq », de 0 à 99). L'ordre des mots est libre et les petits mots (de, du, pour, la, le, et…) sont ignorés. "
           "Sans nom, l'action vise la joueuse sélectionnée à l'écran. "
           f"En mode {b('DIRECT')} (par défaut) l'appli ne parle jamais et ne pose aucune question : {b('1 bip')} = fait, {b('2 bips')} = refusé (rien n'a été fait, redites la phrase en entier). "
           f"Les questions et la voix existent en mode {b('CONFIGURATION')}.")]
    s += sec('1) Chronomètre', [
        ('Lancer', ['Démarrer chrono · Lancer chrono · Relancer chrono · Start chrono', 'Début chrono · Départ chrono', 'Reprise du jeu · Reprise', 'Démarrer le match · Début du match · Coup d’envoi du match']),
        ('Arrêter', ['Arrêter chrono · Arrêt chrono · Arrêt du chrono · Stop chrono · Chrono stop', 'Pause chrono · Couper chrono', 'Temps mort']),
        ('Remettre à une valeur (à tout moment)', ['Mettre chrono à 8 minutes et 30 secondes · Mets le chrono à 5 minutes · Chrono à 45 secondes', 'Mettre chrono à une minute et quinze secondes · Chrono 8 minutes 30', 'Le chrono s’arrête ; secondes de 0 à 59 (sinon 2 bips)'])])
    s += [P("« Chrono » seul : en DIRECT 2 bips (dites démarrer ou arrêter) ; en CONFIGURATION l'appli demande « Démarrer ou arrêter ? ». Chrono déjà lancé (ou arrêté) : elle le dit et ne change rien. Avec « minutes » seul, la commande part une seconde plus tard pour laisser le temps de dire les secondes.", small)]
    s += sec('2) Sélectionner une joueuse', [
        ('Sélectionner', ['Sélectionne Léa · Sélectionner la 7 · Choisis Zoé · Sélection numéro 12']),
        ('Retirer la sélection', ['Désélectionner · Aucune joueuse'])])
    s += sec('3) Tirs et statistiques (enregistrés tout de suite)', [
        ('Tir à 2 points réussi (+2)', ['Inès deux points · 2 points pour Jade · Tir à 2 points réussi pour Eva · Deux points la 9']),
        ('Tir à 2 points manqué', ['Raté à 2 points pour Lola · Tir à 2 points manqué Nora · Clara deux points loupé']),
        ('Tir à 3 points réussi (+3)', ['Camille trois points · 3 points pour Sarah · Tir à 3 points réussi Louise']),
        ('Tir à 3 points manqué', ['Raté à 3 points pour Julie · Tir à 3 points manqué Emma · Lina trois points raté']),
        ('Interception', ['Interception Manon · Zoé intercepte · Vol de balle Léa']),
        ('Rebond offensif', ['Rebond offensif Jade · Rebond off Inès · Rebond en attaque la 14']),
        ('Rebond défensif', ['Rebond défensif Eva · Rebond déf Lola · Rebond en défense la 3']),
        ('Passe décisive', ['Passe décisive Nora · Passe Clara']),
        ('Perte de balle', ['Perte de balle de Sarah · Balle perdue Camille · Louise perte']),
        ('Contre', ['Contre de Julie · Contre de la 11']),
        ('Contre subi', ['Emma contrée · Contre subi Lina'])])
    s += [P("Le tir est « réussi » par défaut ; pour un tir manqué : raté, manqué ou loupé. « Rebond » seul : en DIRECT 2 bips (redites avec offensif ou défensif), en CONFIGURATION l'appli pose la question.", small)]
    s += sec('4) Fautes', [
        ('Faute personnelle', ['Faute de Léa · Faute personnelle Manon · Faute de la 5']),
        ('Faute subie', ['Faute sur Zoé · Faute subie Jade · Faute sur le 12']),
        ('Faute technique', ['Faute technique Inès']),
        ('Faute antisportive', ['Faute antisportive Eva']),
        ('Faute disqualifiante', ['Faute disqualifiante Lola'])])
    s += [P("Aucune confirmation. À la 4e faute personnelle, l'appli annonce « quatrième faute » ; à la 5e (ou après une disqualifiante), « elle sort ».", small)]
    s += sec('5) Lancers francs', [
        ('Ouvrir la série', ['Lancer franc · Lancer franc pour Nora · Lancers francs Clara · LF Sarah']),
        ('Saisir les tentatives', ['Premier réussi · Deuxième raté · Troisième réussi', 'Réussi · Raté (tentative suivante)']),
        ('Enregistrer', ['Automatique après la 3e tentative', 'Terminé · Fini · Validé · OK · C’est bon · Voilà']),
        ('Abandonner', ['Annule · Annuler (rien n’est enregistré)']),
        ('En une phrase', ['Camille 1/3 · Louise 0/2 · Julie un sur trois · Lancers francs Emma deux sur trois'])])
    s += sec('6) Changements de joueuses (enregistrés tout de suite)', [
        ('Remplacement', ['Remplacement Léa, Manon par Zoé, Jade', 'Remplacement la 4, la 7 par la 9, la 10', 'Changement Inès par Eva']),
        ('Sortie / entrée', ['Sortie de Lola, Nora Entrée de Clara, Sarah (ordre inversable)']),
        ('Cinq sur le terrain', ['Sur le terrain on a Camille, Louise, Julie, Emma et Lina', 'Sur le terrain on a 4, 5, 7, 9, 12', '(une courte pause est permise : l’appli attend les prénoms manquants)']),
        ('Verbe « remplace »', ['Zoé remplace Léa']),
        ('Abandonner une question ou une attente', ['Abandon · Abandonne · Annule · Stop · Laisse tomber'])])
    s += [P("Il faut autant de sorties que d'entrées ; la sortante est sur le terrain, l'entrante au banc et sans 5 fautes ; personne n'est citée deux fois. Sinon l'appli le dit et ne change rien.", small)]
    s += sec('7) Fenêtre de changement (écran)', [
        ('Afficher', ['Afficher changement · Affiche le changement · Ouvrir remplacement']),
        ('Valider', ['Valider · Valider changement (après avoir coché à l’écran)']),
        ('Fermer', ['Fermer · Ferme · Masquer'])])
    s += sec('8) Annulation (immédiate, sans validation)', [
        ('Dernière action', ['Annuler la dernière commande · Annule · Supprime · Efface']),
        ('Dernière action d’une joueuse', ['Annuler dernière action Manon · Annuler dernière action la 5'])])
    s += [P("Un changement ne s'annule pas : on en refait un.", small)]
    s += sec('9) Score adverse et questions', [
        ('Score adverse', ['Adversaire un point · Adversaire deux points · Adversaire trois points', 'Adversaire moins deux · Adversaire moins un']),
        ('Questions (réponse écrite dans le bandeau ; dite aussi en CONFIGURATION)', ['Score · Qui est sur le terrain · Combien de fautes Léa · Combien de fautes la 5 · Fautes équipe'])])
    s += sec('10) Numéros de maillot (avant le match seulement)', [
        ('Donner un numéro', ['Candice a le numéro 5 · Candice prend le 5 · Candice porte le numéro 5 · Candice a le 5', 'Candice a le numéro 5 Chloé a le numéro 8 (plusieurs joueuses)', 'Numéro et feuille de match mis à jour ; avertit si une autre joueuse a déjà ce numéro']),
        ('Contrôler les numéros', ['Contrôle numéros joueuses · Contrôle des numéros · Vérifie les numéros · Vérification des numéros', '1 bip : « Numéros tous différents » · 2 bips : les doublons sont nommés (ex. Numéro 0 : Alice, Aliya)'])])
    s += [P("Ces deux commandes sont refusées (2 bips) dès que le match a commencé : action, point ou période enregistrés, ou chrono lancé. Après, les numéros se corrigent dans Configuration → Feuille de Match.", small)]
    s += sec('11) Avant le coup d\'envoi : les cinq de départ', [
        ('Terrain vide', ['Sur le terrain on a Léa, Jade, Inès, Lina et Zoé · Sur le terrain on a 4, 7, 9, 12, 15 · En jeu …', 'Pas d\'événement dans l\'historique ; ensuite « Sur le terrain on a… » devient un changement'])])
    s += [Callout('note', "DIRECT et CONFIGURATION", "En DIRECT (vert, par défaut) : aucune question, aucune voix, bips seulement. Une phrase incomplète est refusée tout de suite (2 bips) ; si deux prénoms se ressemblent exactement, le premier est pris et affiché (« annule » corrige). "
                  "En CONFIGURATION, l'appli peut poser des questions (« Quelle joueuse ? », « offensif ou défensif ? », « Annabelle ou Annaelle ? ») et parler : répondez, ou dites directement une autre commande complète, l'attente est alors abandonnée. "
                  "Le didacticiel (CONFIGURATION → Didacticiel) fait pratiquer toutes ces commandes sur un match de démonstration.")]
    return s

# ================================================================== ANNEXE A : module administrateur
def page_annexe():
    def prof(role, desc): return [Paragraph(role, cellb), Paragraph(desc, cell)]
    t = _table([prof('superadmin', "Accès illimité. Fait tout ce que fait l'admin, et seul à pouvoir créer, modifier ou supprimer un compte superadmin. Ne peut pas être supprimé s'il est le dernier."),
                prof('admin', "Voit toutes les équipes. Crée et modifie les équipes, les joueuses, les matchs. Utilise le menu Administration ; gère les comptes admin, coach et consultant (il ne voit pas les superadmin)."),
                prof('coach', "Ne voit que les équipes qui lui sont affectées, saison par saison ; peut y faire tout le travail de match (joueuses, saisie, stats, exports, calendrier) et importer le PDF FFBB de l'effectif de ses équipes (menu Calendrier, onglet Effectif), sauf créer ou supprimer une équipe."),
                prof('consultant', "Lit les équipes qui lui sont affectées et ne modifie rien : menu Calendrier seulement (calendrier, classement, effectif, PDF des matchs enregistrés). La base refuse toute écriture."),
                prof('Sans profil', "Peut se connecter mais voit seulement « Accès non autorisé ».")], [96, CW - 96], ('Profil', "Ce qu'il permet"))
    rows = [("Un coach ne voit aucune équipe", "Vérifiez qu'il a le profil coach (ou consultant) et qu'au moins une équipe lui est affectée pour la saison (Administration > Accès). Il doit rouvrir l'appli avec du réseau."),
            ("Une vignette n'a pas d'image", "Ouvrez l'équipe, « Chercher dans les données FFBB » et touchez la bonne image ; on peut aussi coller son adresse api.ffbb.com/assets/…"),
            ("Résultats ou classement pas à jour", "Relancez MiseAJourFFBB_Club.exe depuis un PC, puis « Charger les équipes depuis le cache ». Recharger est sans risque."),
            ("Une équipe n'a qu'une phase alors que le site FFBB en montre deux", "Relancez la dernière version de MiseAJourFFBB_Club.exe : elle cherche aussi les autres phases de la compétition. Si une phase manque encore, le programme enregistre une copie de la page dans son dossier « diagnostic » : transmettez-la pour adapter la lecture."),
            ("Le programme affiche « HTTP 403 » ou « 404 »", "403 : blocage temporaire du site, le programme réessaie seul (pauses) ; sinon relancez plus tard. 404 : le message donne les adresses essayées ; notez-les avec le nom de la compétition."),
            ("Une équipe manque", "Elle n'a pas de poule dans le cache (pas encore engagée, ou exe non relancé). Le détail du chargement liste les poules ignorées ou en erreur."),
            ("Après l'import d'un effectif, une personne manque", "L'appli relit la base et nomme toute personne non enregistrée (« 14 / 15 enregistrées »). Réimportez ; si elle manque encore, transmettez le message."),
            ("Un renfort est introuvable ou « fonction manquante »", "Exécutez admin_10_merge_roster.sql ; l'équipe doit être liée au club (Administration > Équipes) et l'équipe d'origine doit avoir des joueuses."),
            ("Une modification est refusée sur un ancien match", "Saison clôturée (avant le 1er septembre) : lecture seule pour tous. Correction exceptionnelle par le superadmin, directement en base."),
            ("Un match est introuvable par son numéro", "Il n'est pas dans le calendrier de vos équipes : relancez le chargement, ou passez le match en AMICAL."),
            ("Message « permission denied » ou « table introuvable »", "Un script SQL de l'installation n'a pas été exécuté (voir la liste), ou le compte n'a pas le profil admin / superadmin.")]
    faq = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in rows], [150, CW - 150], ('Situation', 'Que faire ?'))
    scripts = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in (
        ('security_01', 'Profils et règles de sécurité de base.'),
        ('admin_01_club_calendar', 'Superadmin, équipes du club par saison, phases, calendriers, classements.'),
        ('admin_03_roster', "Effectif (import du PDF de l'extranet)."),
        ('admin_04_role_coach', "Le profil « analyst » devient « coach » (seulement si des comptes existaient déjà)."),
        ('admin_05_season_lock', 'Saisons terminées en lecture seule.'),
        ('admin_06_last_superadmin', 'Interdit de supprimer le dernier superadmin ; droits pour l\'accès de secours.'),
        ('admin_07_hide_superadmin', 'Un admin ne voit pas les comptes superadmin.'),
        ('admin_08_roster_coach', "Case « Coach » de l'encadrement."),
        ('admin_09_role_consultant', 'Profil consultant (lecture seule).'),
        ('admin_10_merge_roster', 'Fiche joueuse unique (maillot + licence) et fonction des renforts.'),
        ('voice_01_calibration', 'Calibrage de la commande vocale, enregistré par compte (suit l’utilisateur d’un appareil à l’autre).'),
        ('voice_02_shared', 'Apprentissages de la commande vocale partagés entre tous les comptes du club (à lancer après voice_01).'),
        ('stats_save_atomic', "Enregistrement d'un match en une seule opération, avec numéro de version et nom du dernier enregistreur (étape 16)."),
        ('stats_match_lock', "Cadenas de saisie d'un match : nom, dernière activité, prise de main (étape 16 ; à lancer après stats_save_atomic)."))], [140, CW - 140], ('Script SQL (dans cet ordre)', 'À quoi il sert'))
    s = [Banner('A', 'Module administrateur', 'Équipes du club, calendriers, effectifs et accès'),
         P(f"Réservé aux profils {b('admin')} et {b('superadmin')} : le bouton {b('Administration')} (la roue violette, en haut à droite) n'existe pas pour un coach. "
           "Un bandeau d'icônes en haut de l'écran choisit la section : Équipes & calendriers, ou Accès."),
         t, Spacer(1, 4),
         H2('Équipes & calendriers'),
         KeepTogether([MockAdmin(), P("Administration > Équipes & calendriers", caption)]),
         NumItem(1, f"{b('Le bandeau')} : {chip('Équipes & calendriers', 'yellow')} ou {chip('Accès', 'gray')}."),
         NumItem(2, f"{b('Charger les équipes depuis le cache.')} Le site de la FFBB bloque les serveurs : le cache FFBB est rempli par le programme "
                    f"{chip('MiseAJourFFBB_Club.exe', 'blue')} à lancer depuis un PC (le lien est dans l'écran). Le bouton lit ensuite ce cache, "
                    "garde les poules de la saison en cours, repère les équipes d'OLYMPIC SATHONAY et enregistre pour chacune ses phases, son calendrier et son classement. "
                    "Une barre de progression s'affiche ; le détail liste les poules ignorées ou en erreur."),
         NumItem(3, f"{b('Une vignette par équipe')} (U11 F, U13 F, U15 F · équipe 2…), avec l'image FFBB du niveau. L'équipe TeamStats correspondante, "
                    "« SATHONAY U15F - 2026/2027 », est créée automatiquement (ou reprise si elle existe déjà avec ce nom)."),
         NumItem(4, f"{b('Deux onglets par équipe')} : {chip('Effectif', 'yellow')} et {chip('Phases & calendrier', 'gray')}. Les phases s'affichent ainsi : "
                    "« Phase 1 : Départementale féminine U15 - Division 2 - poule C » (le numéro vient du libellé FFBB), avec le numéro de phase et de poule FFBB ; "
                    "un toucher sur une phase affiche son calendrier et son classement."),
         NumItem(5, f"{b('Importer un PDF extranet FFBB')} : l'effectif de l'équipe (voir ci-dessous)."),
         CondPageBreak(170), H2("Effectif : une fiche unique par joueuse"),
         P("Une équipe chargée depuis le PDF et l'équipe TeamStats sont la même équipe : la fiche d'une joueuse cumule le " + b('numéro de maillot') + " (saisi dans TeamStats) et la "
           + b('licence, la date de naissance, la catégorie') + " (PDF de l'extranet). Il n'y a qu'une seule liste, que l'on retrouve à l'étape 1 et ici."),
         KeepTogether([MockRoster(), P("Aperçu avant import (les photos ne sont jamais lues ; données fictives)", caption)]),
         NumItem(1, f"Dans l'extranet FFBB, téléchargez le {b('trombinoscope PDF')} de l'équipe. Dans TeamStats : l'équipe, onglet {chip('Effectif', 'yellow')}, "
                    f"{chip('Importer un PDF extranet FFBB', 'blue')}. Le PDF est lu sur votre appareil : seuls {b('nom, prénom, n° de licence, date de naissance et sexe')} sont gardés, jamais les photos."),
         NumItem(2, f"{b('Affectation')} : chaque personne est rattachée à l'équipe indiquée dans le PDF (« U11 FILLES », n° 1 = U11 F ; n° 2 = U11 F · équipe 2). "
                    "Sinon c'est la date de naissance qui décide : âge = année de fin de saison - année de naissance (10 ou 11 ans : U11 ; 12-13 ans : U13…), à sexe égal."),
         Paragraph("Chaque ligne se corrige avant l'import : décocher, changer d'équipe ou de rôle. Les adultes d'une équipe de jeunes sont proposés en "
                   f"{chip('encadrement', 'gray')} ; le {b('premier encadrant')} d'une équipe sans coach est coché {chip('Coach', 'green')} (on peut en cocher plusieurs). "
                   f"Le badge {b('Surclassement U13')} apparaît quand une joueuse joue dans une catégorie plus haute que celle de son âge {b('et')} qu'une équipe plus jeune existe au club "
                   "(pas de badge en U11 F si l'équipe U9 F n'existe pas). Le code de la fiche FFBB (ex. « D11 ») reste affiché.", ParagraphStyle('ind', parent=body, leftIndent=25.5)),
         NumItem(3, f"{chip('Importer', 'green')} : la joueuse déjà présente dans TeamStats (même licence, sinon même nom) est {b('complétée en gardant son numéro de maillot')} ; les autres sont créées "
                    "avec le maillot 0, à régler dans la liste (case N°). Réimporter est sans risque. L'option « retirer de l'équipe les absents du PDF » est décochée par défaut et ne touche jamais les fiches saisies à la main. "
                    "Un contrôle relit la base (« 15 / 15 enregistrées »)."),
         Callout('note', 'Données personnelles', "Noms, licences et dates de naissance de mineurs : lisibles seulement par les admin et par les comptes affectés à l'équipe (coach, consultant : onglet Effectif du menu Calendrier, lecture seule). "
                 "L'encadrement n'apparaît jamais dans les feuilles de match."),
         H2('Accès : comptes et équipes'),
         NumItem(1, f"{chip('Nouveau compte', 'blue')} : e-mail, nom affiché, mot de passe (le bouton {chip('Générer', 'gray')} en propose un) et profil. "
                    f"{b('Notez le mot de passe maintenant')} : il ne s'affiche plus ensuite. Le compte est actif tout de suite."),
         NumItem(2, f"{b('Modifier un compte')} : touchez la ligne de la personne. Changez le nom, le {b('profil')} (coach, consultant, admin…), éventuellement le mot de passe, "
                    f"puis touchez {chip('Enregistrer', 'green')} : rien n'est modifié avant."),
         NumItem(3, f"{b('Affecter des équipes à un coach ou un consultant')} : donnez-lui d'abord son profil et enregistrez. La liste « Équipes affectées » apparaît : "
                    "choisissez la saison, puis touchez une ou plusieurs vignettes (coche verte = équipe ouverte ; un nouveau toucher la retire). "
                    "Exemple : U13 F en 2025-2026, U15 F ou U15 M en 2026-2027. L'affectation est immédiate. Un admin ou superadmin voit toutes les équipes : rien à affecter."),
         NumItem(4, f"{b('Désactiver')} un compte (il ne peut plus se connecter) ou le {b('supprimer')} : boutons en bas de la fiche. {b('Tester')} ce que voit un coach : bouton Mon compte (étape 13)."),
         Callout('note', 'Qui peut modifier qui ?', "Un admin gère les comptes admin, coach et consultant ; seul le superadmin gère les superadmin (invisibles pour un admin). "
                 "Personne ne peut changer son propre profil, se désactiver ou se supprimer."),
         CondPageBreak(170), H2('Installation (une seule fois, par la personne qui gère la base)'),
         NumItem(1, f"Dans l'éditeur SQL de Supabase, exécutez les scripts du dossier {chip('sql', 'gray')} dans cet ordre (chacun se rejoue sans risque) :"),
         scripts, Spacer(1, 6),
         NumItem(2, "Désignez le premier superadmin : la requête est à la fin de admin_01_club_calendar.sql (une ligne, avec votre adresse e-mail)."),
         NumItem(3, f"Sur Vercel (Settings > Environment Variables), ajoutez {chip('SUPABASE_SERVICE_ROLE_KEY', 'gray')} (la clé « service_role » de Supabase : lister et créer les comptes, tester un profil) "
                    f"et, pour l'accès de secours, {chip('EMERGENCY_SUPERADMIN_EMAIL', 'gray')} et {chip('EMERGENCY_ACCESS_SECRET', 'gray')}. Aucune ne doit être partagée."),
         Callout('warn', "À faire une fois : fermer l'inscription libre.", "Supabase, Authentication, Sign In / Providers : désactivez « Allow new users to sign up ». "
                 "Les comptes se créent désormais depuis Administration > Accès."),
         H2('Ne jamais perdre l’accès'),
         NumItem(1, f"{b('Protection automatique')} : la base refuse de supprimer ou de rétrograder le {b('dernier superadmin')}, depuis l'appli comme depuis Supabase. Créez un second superadmin avant de toucher au premier."),
         NumItem(2, f"{b('Accès de secours')} : si l'accès est perdu malgré tout, le lien discret « Accès de secours » de l'écran de connexion demande un {b('code de secours')} (la variable EMERGENCY_ACCESS_SECRET, "
                    "rangée dans votre gestionnaire de mots de passe) et un nouveau mot de passe : le serveur recrée ou répare le compte du propriétaire (l'adresse de EMERGENCY_SUPERADMIN_EMAIL) et vous connecte. "
                    "Il ne donne accès à rien d'autre, et chaque usage est journalisé."),
         NumItem(3, f"{b('Sans l’appli')} : avec votre compte Supabase, recréez le compte dans Authentication > Users puis exécutez la requête SQL indiquée en tête de admin_06_last_superadmin.sql."),
         H2('Un souci ? Réponses rapides (administrateur)'), faq]
    return s

# ================================================================== retouches des pages d'origine (superposition)
def overlay(page_index, draw_fn):
    buf = io.BytesIO(); c = rl_canvas.Canvas(buf, pagesize=(PW, PH)); draw_fn(c); c.save(); buf.seek(0)
    return PdfReader(buf).pages[0]

def flow_at(c, flowables, x, top, width=CW):
    """Dessine des flowables à partir de la position « top » (distance depuis le haut de la page)."""
    y = PH - top
    for k, f in enumerate(flowables):
        st = getattr(f, 'style', None)
        if st is not None and k > 0: y -= st.spaceBefore
        w, h = f.wrap(width, 2000); y -= h
        f.drawOn(c, x, y)
        if st is not None: y -= st.spaceAfter
    return PH - y

def patch_cover(c):  # couverture : numéro de version, sous le titre et le slogan
    c.setFillColor(LIGHTBLUE); c.setFont('Poppins-Medium', 10)
    c.drawCentredString(PW / 2, PH - 541, f'Version {VERSION}')

def patch_page3(c):  # étape 1 : équipes créées automatiquement
    flow_at(c, [Callout('tip', 'Équipes créées automatiquement.',
                        "Quand l'administrateur charge les équipes du calendrier FFBB (annexe A), l'équipe « SATHONAY U15F - 2026/2027 » existe déjà avec le bon nom : "
                        "il ne reste qu'à y saisir les joueuses comme ci-dessus. Seul l'administrateur crée des équipes ; un coach modifie celles qui lui sont ouvertes.")],
            LM, 646)

def patch_page4(c):  # étape 2 : la loupe
    c.setFillColor(white); c.rect(40, PH - 692, PW - 80, 692 - 523.5, fill=1, stroke=0)   # efface les anciens paragraphes + encadré
    items = [P(f"Touchez la loupe : la fenêtre {b('Matchs')} s'ouvre, avec trois onglets : {chip('JOUÉ', 'green')}, {chip('À VENIR', 'blue')} et {chip('TOUS', 'gray')}. "
               f"Si une équipe est déjà choisie plus haut, la liste commence par {b('les matchs de cette équipe')} ; changez le filtre pour voir les autres. "
               "On peut aussi filtrer par saison. La pastille OFFICIEL rappelle que seuls les matchs officiels sont listés. Les matchs viennent du calendrier chargé "
               "par l'administrateur (annexe A), pour toutes les équipes du club."),
             P(f"{chip('À VENIR', 'blue')} : les matchs à préparer, du plus proche au plus lointain. {chip('JOUÉ', 'green')} : les matchs dont les statistiques sont enregistrées "
               f"(pour les rouvrir) {b('et')} les matchs déjà joués du calendrier, {b('de toutes les phases de la saison')}, dont les statistiques ne sont pas encore saisies "
               "(mention « joué, stats non saisies » et score FFBB)."),
             P(f"{b('Touchez un match')} : l'équipe, domicile/extérieur, l'adversaire, la date et le numéro FFBB se remplissent d'un seul geste, et vous restez sur l'écran "
               "de configuration pour vérifier avant de démarrer. Vous pouvez aussi taper le numéro FFBB à la main : quand « trouvé ✓ » s'affiche, l'équipe, "
               "domicile/extérieur, l'adversaire et la date sont remplis."),
             Callout('note', 'Match introuvable ?', "Si « introuvable » s'affiche, le match n'est pas dans le calendrier de vos équipes (ou l'administrateur ne l'a pas encore chargé). "
                     "Passez en AMICAL et tapez le nom de l'adversaire, ou prévenez la personne qui gère l'application.")]
    flow_at(c, items, LM, 524)

def patch_page5(c):  # étape 3 : renforts
    flow_at(c, [Callout('good', "Renfort d'une autre équipe.",
                        f"Au-dessus de la liste, {chip('+ Renfort d’une autre équipe', 'green')} : choisissez {b('d’abord l’équipe')} d’origine, puis les joueuses. Autorisées : même catégorie (autre équipe), catégorie juste en dessous ou "
                        "au-dessus (U15 F : U13 F, U15 F équipe 2, U18 F) ; l'autre sexe seulement en U9 et U11, dans la même catégorie. Le renfort est en vert avec son équipe entre parenthèses (ex. U13F) ; "
                        "il compte dans les 10 joueuses maximum, reste vert dans le Direct et figure dans les statistiques. Changer d'équipe remet les renforts à zéro.")], LM, 674)


def patch_page8(c):  # étape 7 : le chrono suit la période choisie
    c.setFillColor(white); c.rect(40, PH - 376, PW - 80, 376 - 343, fill=1, stroke=0)
    flow_at(c, [NumItem(2, f"Le chrono {b('se règle seul')} sur la nouvelle période : durée complète si rien n'y a encore été saisi, sinon temps restant d'après les statistiques déjà "
                           f"saisies. Pour la recommencer à zéro : touchez {chip('RESET', 'gray')} et confirmez.", AMBER_D)], LM + 0.0, 342.5)
    c.setFillColor(HexColor('#FEF3C7')); c.rect(54, PH - 646, PW - 108 + 0.5, 646 - 601, fill=1, stroke=0)
    flow_at(c, [P("Pour les catégories plus jeunes, le bouton + reste grisé à la fin du match. De même, il n'est pas possible de passer en prolongation si le score n'est pas à égalité. "
                  "Si vous repassez d'une prolongation à Q4 (ou l'inverse), le chrono affiche le temps restant de la période choisie, d'après ses statistiques (durée complète si elle est vierge).",
                  ParagraphStyle('co2', fontName='Carlito', fontSize=10, leading=13.4, textColor=TEXT))], 60, 602, width=CW - 18)


def patch_page9(c):  # étape 8 : protection des matchs déjà joués
    items = [H2('Protection des matchs déjà joués'),
             P(f"Un match dont la {b('date est antérieure à aujourd\'hui')} est considéré comme joué : ses statistiques sont protégées. "
               "En touchant la disquette, une fenêtre « Ce match est déjà joué » s'ouvre avant tout enregistrement."),
             NumItem(1, "Lisez la date indiquée : enregistrer remplace les statistiques déjà enregistrées pour ce match."),
             NumItem(2, f"Écrivez le mot {b('confirmation')} dans la case : le bouton {chip('Valider', 'green')} ne s'active qu'à ce moment-là (Entrée valide aussi)."),
             NumItem(3, f"{chip('Annuler', 'gray')}, ou un toucher à côté de la fenêtre, ferme sans rien enregistrer."),
             Callout('note', 'Bon à savoir', "Un match daté d'aujourd'hui ou à venir s'enregistre directement. Sans réseau, la confirmation est demandée au moment où vous touchez la disquette ; "
                     "l'envoi automatique au retour du réseau ne la redemande pas.")]
    flow_at(c, items, LM, 566)

def patch_page7(c):  # étape 5 : le temps de jeu (rappel) + commande vocale
    c.setFillColor(white); c.rect(40, PH - 762, PW - 80, 762 - 697, fill=1, stroke=0)
    flow_at(c, [Callout('good', 'Le temps de jeu suit le chrono.',
                        "Le temps de présence de chaque joueuse ne s'additionne que lorsque le chrono tourne : lancez-le au coup d'envoi, mettez-le en pause à chaque arrêt de jeu "
                        "(à la voix : « démarrer le match », « arrêt chrono », « mettre chrono à… »). Le total est plafonné à 5 joueuses × la durée de la période : étape 15. "
                        "Le bandeau « Commande vocale » est expliqué à l'étape 14.")], LM, 699)

def patch_page10(c):  # étape 9 : temps de jeu plafonné (ligne Tps du tableau)
    c.setFillColor(white); c.rect(338, PH - 701, PW - 338 - 40, 701 - 683, fill=1, stroke=0)
    c.setFillColor(TEXT); c.setFont('Carlito', 10); c.drawString(343.3, PH - 694.3, 'Temps de jeu mm:ss, plafonné (étape 15).')

# ================================================================== assemblage
def main():
    base = PdfReader(BASE)
    w = PdfWriter()
    n_voc = len(build(page_vocal(), 0).pages); n_t = len(build(page_temps(), 0).pages); n_p = len(build(page_partage(), 0).pages); n_a = len(build(page_annexe(), 0).pages)
    pg_voc = 14; pg_t = pg_voc + n_voc; pg_p = pg_t + n_t; pg_a = pg_p + n_p; pg_b = pg_a + n_a   # numéro de la première page de chaque partie
    cover = base.pages[0]; cover.merge_page(overlay(0, patch_cover))
    w.add_page(cover)                                               # couverture (+ numéro de version)
    for p in build(page_accueil(pg_voc, pg_t, pg_p, pg_a, pg_b), 1).pages: w.add_page(p)   # accueil / programme (reconstruit)
    patches = {2: patch_page3, 3: patch_page4, 4: patch_page5, 5: patch_page7, 7: patch_page8, 8: patch_page9, 9: patch_page10}   # index dans le PDF d'origine
    for i in range(2, 12):                                          # étapes 1 à 11 (pages d'origine)
        pg = base.pages[i]
        if i in patches: pg.merge_page(overlay(i, patches[i]))
        w.add_page(pg)
    for p in build(page_calendrier(), 12).pages: w.add_page(p)      # étape 12
    for p in build(page_nouveautes(), 13).pages: w.add_page(p)      # étape 13
    for p in build(page_vocal(), pg_voc).pages: w.add_page(p)       # étape 14 : commande vocale
    for p in build(page_temps(), pg_t).pages: w.add_page(p)         # étape 15 : temps de jeu et chrono
    for p in build(page_partage(), pg_p).pages: w.add_page(p)       # étape 16 : deux personnes sur le même match
    for p in build(page_annexe(), pg_a).pages: w.add_page(p)        # annexe A
    for p in build(page_annexe_voix(), pg_b).pages: w.add_page(p)   # annexe B : récapitulatif des commandes vocales
    w.add_metadata({'/Title': "TeamStats - Mode d'emploi", '/Author': 'Olympic Sathonay', '/Subject': 'Suivi de match et statistiques ' + ('(version ' + VERSION + ')' if VERSION else '')})
    with open(OUT, 'wb') as f: w.write(f)
    print('pages :', len(w.pages))

if __name__ == '__main__':
    main()
