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
    def wrap(self, aw, ah): return aw, 15.0
    def draw(self):
        c = self.canv; c.setFillColor(TEXT); c.setFont('Carlito', 10.2); c.drawString(0, 3.5, self.text)
        c.drawRightString(CW, 3.5, str(self.page))
        x0 = pdfmetrics.stringWidth(self.text, 'Carlito', 10.2) + 5
        x1 = CW - pdfmetrics.stringWidth(str(self.page), 'Carlito', 10.2) - 5
        c.setFillColor(MUTED)
        x = x0
        while x < x1:
            c.drawString(x, 3.5, '.'); x += 5.1

class IconRow(Flowable):
    """Une ligne « bouton : à quoi il sert »."""
    def __init__(self, icon, name, desc, draw_icon=None):
        super().__init__(); self.icon, self.name, self.desc, self.draw_icon = icon, name, desc, draw_icon
        self.p = Paragraph(desc, ParagraphStyle('ir', fontName='Carlito', fontSize=9.6, leading=12, textColor=TEXT))
    def wrap(self, aw, ah):
        self.ph = self.p.wrap(aw - 148, ah)[1]; self.h = max(25.2, self.ph + 9); return aw, self.h
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
def page_accueil(pg_vocal=14, pg_annexe_a=14, pg_annexe_b=15):
    s = [P('Bienvenue', h1),
         P("TeamStats suit un match de basket en direct, joueuse par joueuse, partage les statistiques en PDF et donne le calendrier, "
           f"les résultats et le classement de vos équipes. Ce guide explique tout, pas à pas, {b('sans notion technique')}."), H2('Au programme')]
    toc = [("Étape 1 · Créer l'équipe et les joueuses", 2), ('Étape 2 · Préparer le match', 3), ('Étape 3 · Choisir les joueuses du match', 4),
           ('Étape 4 · Démarrer le match', 4), ("Étape 5 · L'écran Direct", 5), ('Étape 6 · Saisir les actions', 6),
           ('Étape 7 · Changements, périodes et prolongations', 7), ('Étape 8 · Enregistrer et retrouver un match', 8),
           ('Étape 9 · Statistiques et rapports PDF', 9), ("Étape 10 · Utiliser l'appli sans réseau", 10),
           ('Étape 11 · Historique, aide-mémoire et dépannage', 11), ('Étape 12 · Le menu Calendrier', 12),
           ('Étape 13 · Mon compte et nouveautés', 13), ('Étape 14 · La commande vocale', pg_vocal),
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
                    "La compétition et la poule sont rappelées dessous (ex. Départementale féminine U15 - Division 2 · Poule C). Une coupe est une seule entrée {chip('Coupe', 'gray')}, rangée par tours (1er tour, 2e tour…)."),
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
def page_vocal():
    faq = _table([[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in (
        ('« Commande non reconnue »', "Répétez plus lentement et plus près du micro. Si le prénom n'est jamais compris, ajoutez sa prononciation avec le bouton Prénoms (ex. « Candy, kandis »). Le mode diagnostic montre ce que le navigateur a entendu."),
        ("L'appli pose une question (« Quelle joueuse ? », « offensif ou défensif ? »)", "Répondez simplement (« Léa », « offensif »), ou dites directement une autre commande complète : la question est abandonnée."),
        ("« Untel n'est pas sur le terrain »", "L'action est refusée comme avec les boutons. Faites d'abord le changement, puis répétez l'action."),
        ('Rien ne se passe', "Vérifiez que l'interrupteur est vert (ACTIVE), que le réseau est présent et que le micro est autorisé pour le site dans le navigateur."),
        ('Un mauvais prénom ou une mauvaise action est enregistré', "Dites « annule la dernière commande », ou « annule dernière action » suivi du prénom."))],
        [150, CW - 150], ('Situation', 'Que faire ?'))
    return [Banner(14, 'La commande vocale', 'Saisir les actions à la voix, sans quitter le match des yeux'),
         P(f"Dans l'écran {b('Direct')}, un petit bandeau {b('Commande vocale')} permet de saisir presque tout à la voix : tirs, fautes, rebonds, lancers francs, changements, chrono. "
           f"{b('Les boutons restent toujours là')} et font tout, comme avant : la voix est un plus, jamais une obligation."),
         H2('Mettre en route'),
         NumItem(1, f"Touchez {chip('COMMANDE VOCALE : COUPÉE', 'gray')} : il devient {chip('ACTIVE', 'green')}. Le mode est coupé à chaque ouverture de l'appli. Autorisez le micro la première fois."),
         NumItem(2, f"Il faut {b('Chrome')} et du {b('réseau')} (le navigateur envoie l'audio à son fournisseur pour le comprendre). Un {b('casque')} est conseillé : l'appli ne s'entend pas elle-même. L'écran reste allumé tant que le mode est actif."),
         NumItem(3, f"Parlez naturellement, {b('une commande par phrase')}. L'appli répète en quelques mots (« Candice, deux points »). Un bandeau coloré donne le résultat : {b('vert')} enregistré, {b('orange')} en attente d'une réponse, {b('rouge')} commande non reconnue ou refusée. La joueuse et la touche concernées s'allument à l'écran."),
         H2('Comment parler'),
         NumItem(1, f"{b('Désigner une joueuse')} : par son {b('prénom')} ou son {b('numéro')} (« la 5 », « le 12 », « numéro 5 »). L'ordre est libre : « Léa deux points » ou « deux points pour Léa »."),
         NumItem(2, f"{b('Sélectionner')} : « sélectionne Manon » allume sa carte. La joueuse sélectionnée (ou touchée à l'écran) devient la joueuse par défaut : « deux points », « interception », « lancer franc » suffisent."),
         NumItem(3, f"{b('Sans validation')} : les actions sont enregistrées tout de suite. Pour corriger : {b('« annule la dernière commande »')} ou {b('« annule dernière action »')} suivi du prénom."),
         NumItem(4, f"{b('Changements')} : l'appli lit « Sortent … Entrent … Valide ? » et attend {b('« oui »')} ou {b('« non »')}. Un changement ne s'annule pas : on en refait un."),
         NumItem(5, f"{b('Lancers francs')} : « lancer franc » ouvre la série, visible à l'écran (LF 1, LF 2, LF 3). Dites « premier réussi », « deuxième raté », ou simplement « réussi » / « raté ». La série est enregistrée après la 3e tentative ou par « terminé »."),
         NumItem(6, f"{b('Chrono')} : « démarrer chrono », « démarrer le match », « arrêt chrono », « temps mort »."),
         Callout('warn', 'Décalage', "Comptez 1 à 3 secondes entre la voix et son effet, chrono compris : le temps de jeu en tient compte, pas besoin de corriger."),
         Callout('tip', 'Aide intégrée', f"Le bouton {chip('Aide', 'blue')} du bandeau liste toutes les commandes, avec des exemples ; le bouton {chip('Prénoms', 'blue')} apprend à l'appli la prononciation des prénoms difficiles. La liste complète est en annexe B."),
         CondPageBreak(200), H2('Si ça ne marche pas'), faq]

# ================================================================== ANNEXE B : récapitulatif des commandes vocales
def page_annexe_voix():
    def sec(title, rows, head=('Action', 'Phrases reconnues')):
        data = [[Paragraph(a, cellb), Paragraph('<br/>'.join('– ' + x for x in ph), cell)] for a, ph in rows]
        return [CondPageBreak(120), H2(title), _table(data, [135, CW - 135], head)]
    s = [Banner('B', 'Récapitulatif des commandes vocales', 'Toutes les phrases reconnues, par thème'),
         P(f"Les prénoms et numéros ci-dessous sont des {b('exemples')} : remplacez-les par ceux de vos joueuses. Une joueuse se désigne par son {b('prénom')} ou son {b('numéro')} "
           "(« la 5 », « le 12 », « numéro 5 », « cinq », de 0 à 99). L'ordre des mots est libre et les petits mots (de, du, pour, la, le, et…) sont ignorés. "
           "Sans nom, l'action vise la joueuse sélectionnée à l'écran.")]
    s += sec('1) Chronomètre', [
        ('Lancer', ['Démarrer chrono · Lancer chrono · Relancer chrono · Start chrono', 'Début chrono · Départ chrono', 'Reprise du jeu · Reprise', 'Démarrer le match · Début du match · Coup d’envoi du match']),
        ('Arrêter', ['Arrêter chrono · Arrêt chrono · Arrêt du chrono · Stop chrono · Chrono stop', 'Pause chrono · Couper chrono', 'Temps mort'])])
    s += [P("« Chrono » seul : l'appli demande « Démarrer ou arrêter ? ». Chrono déjà lancé (ou arrêté) : elle le dit et ne change rien.", small)]
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
    s += [P("Le tir est « réussi » par défaut ; pour un tir manqué : raté, manqué ou loupé. « Rebond » seul : l'appli demande offensif ou défensif.", small)]
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
    s += sec('6) Changements de joueuses (à confirmer par « oui »)', [
        ('Remplacement', ['Remplacement Léa, Manon par Zoé, Jade', 'Remplacement la 4, la 7 par la 9, la 10', 'Changement Inès par Eva']),
        ('Sortie / entrée', ['Sortie de Lola, Nora Entrée de Clara, Sarah (ordre inversable)']),
        ('Cinq sur le terrain', ['Sur le terrain on a Camille, Louise, Julie, Emma et Lina', 'Sur le terrain on a 4, 5, 7, 9, 12']),
        ('Verbe « remplace »', ['Zoé remplace Léa']),
        ('Répondre', ['Oui · Valide · OK · Confirme · D’accord · C’est bon · Vas-y', 'Non · Annule · Stop · Laisse tomber'])])
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
        ('Questions (réponse vocale)', ['Score · Qui est sur le terrain · Combien de fautes Léa · Combien de fautes la 5 · Fautes équipe'])])
    s += [Callout('note', "Quand l'appli attend une réponse", "Elle pose parfois une question (« Quelle joueuse ? », « offensif ou défensif ? », « Annabelle ou Annaelle ? »). Répondez, ou dites directement une autre commande complète : "
                  "l'attente est abandonnée et la nouvelle commande s'exécute.")]
    return s

# ================================================================== ANNEXE A : module administrateur
def page_annexe():
    def prof(role, desc): return [Paragraph(role, cellb), Paragraph(desc, cell)]
    t = _table([prof('superadmin', "Accès illimité. Fait tout ce que fait l'admin, et seul à pouvoir créer, modifier ou supprimer un compte superadmin. Ne peut pas être supprimé s'il est le dernier."),
                prof('admin', "Voit toutes les équipes. Crée et modifie les équipes, les joueuses, les matchs. Utilise le menu Administration ; gère les comptes admin, coach et consultant (il ne voit pas les superadmin)."),
                prof('coach', "Ne voit que les équipes qui lui sont affectées, saison par saison ; peut y faire tout le travail de match (joueuses, saisie, stats, exports, calendrier) sauf créer ou supprimer une équipe."),
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
        ('admin_10_merge_roster', 'Fiche joueuse unique (maillot + licence) et fonction des renforts.'))], [140, CW - 140], ('Script SQL (dans cet ordre)', 'À quoi il sert'))
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

# ================================================================== assemblage
def main():
    base = PdfReader(BASE)
    w = PdfWriter()
    n_voc = len(build(page_vocal(), 0).pages)
    n_a = len(build(page_annexe(), 0).pages)
    pg_voc, pg_a, pg_b = 14, 14 + n_voc, 14 + n_voc + n_a
    w.add_page(base.pages[0])                                       # couverture (inchangée)
    for p in build(page_accueil(pg_voc, pg_a, pg_b), 1).pages: w.add_page(p)   # accueil / programme (reconstruit)
    patches = {2: patch_page3, 3: patch_page4, 4: patch_page5, 7: patch_page8, 8: patch_page9}      # index dans le PDF d'origine
    for i in range(2, 12):                                          # étapes 1 à 11 (pages d'origine)
        pg = base.pages[i]
        if i in patches: pg.merge_page(overlay(i, patches[i]))
        w.add_page(pg)
    for p in build(page_calendrier(), 12).pages: w.add_page(p)      # étape 12
    for p in build(page_nouveautes(), 13).pages: w.add_page(p)      # étape 13
    n_voc = len(build(page_vocal(), 0).pages)                       # nombre de pages de chaque partie (pour la numérotation)
    n_a = len(build(page_annexe(), 0).pages)
    pg_voc, pg_a, pg_b = 14, 14 + n_voc, 14 + n_voc + n_a
    for p in build(page_vocal(), pg_voc).pages: w.add_page(p)       # étape 14 : commande vocale
    for p in build(page_annexe(), pg_a).pages: w.add_page(p)        # annexe A
    for p in build(page_annexe_voix(), pg_b).pages: w.add_page(p)   # annexe B : récapitulatif des commandes vocales
    w.add_metadata({'/Title': "TeamStats - Mode d'emploi", '/Author': 'Olympic Sathonay', '/Subject': 'Suivi de match et statistiques'})
    with open(OUT, 'wb') as f: w.write(f)
    print('pages :', len(w.pages))

if __name__ == '__main__':
    main()
