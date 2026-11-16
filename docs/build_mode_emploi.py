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
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)

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
        rows = [('BARABE', 'Juliette', 'BC169984', '05/04/2016 (11 ans)', 'U11 F', 'joueur', None),
                ('COLANGE', 'Daphné', 'BC175604', '09/10/2017 (10 ans)', 'U11 F', 'joueur', None),
                ('LOUEE', 'Clara', 'BC183100', '18/07/2018 (9 ans)', 'U11 F', 'joueur', 'Surclassement U11'),
                ('CHERIOT', 'Ombeline', 'VT820200', '05/06/1982 (45 ans)', 'U11 F', 'encadrement', None)]
        for i, (ln, fn, lic, bd, tm, role, badge) in enumerate(rows):
            y = self.H - 40 - i * 21
            c.setFillColor(HexColor('#111C33')); c.roundRect(10, y - 4, self.W - 20, 19, 4, fill=1, stroke=0)
            c.setFillColor(AMBER); c.rect(16, y + 1, 7, 7, fill=1, stroke=0)
            c.setFillColor(NAVY); c.setFont('DejaVu', 5.5); c.drawString(16.8, y + 2, '✓')
            c.setFillColor(white); c.setFont('Carlito-Bold', 8.6); c.drawString(30, y + 4, ln); w = pdfmetrics.stringWidth(ln, 'Carlito-Bold', 8.6)
            c.setFont('Carlito', 8.6); c.drawString(34 + w, y + 4, fn)
            if badge:
                bw = pdfmetrics.stringWidth(badge.upper(), 'Poppins-Bold', 5.2) + 8
                c.setFillColor(HexColor('#4A3508')); c.setStrokeColor(AMBER); c.setLineWidth(0.6)
                c.roundRect(40 + w + pdfmetrics.stringWidth(fn, 'Carlito', 8.6), y + 2.2, bw, 9.5, 4.7, fill=1, stroke=1)
                c.setFillColor(HexColor('#FCD34D')); c.setFont('Poppins-Bold', 5.2); c.drawString(44 + w + pdfmetrics.stringWidth(fn, 'Carlito', 8.6), y + 5.2, badge.upper())
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
def page_accueil():
    s = [P('Bienvenue', h1),
         P("TeamStats suit un match de basket en direct, joueuse par joueuse, partage les statistiques en PDF et donne le calendrier, "
           f"les résultats et le classement de vos équipes. Ce guide explique tout, pas à pas, {b('sans notion technique')}."), H2('Au programme')]
    toc = [("Étape 1 · Créer l'équipe et les joueuses", 2), ('Étape 2 · Préparer le match', 3), ('Étape 3 · Choisir les joueuses du match', 4),
           ('Étape 4 · Démarrer le match', 4), ("Étape 5 · L'écran Direct", 5), ('Étape 6 · Saisir les actions', 6),
           ('Étape 7 · Changements, périodes et prolongations', 7), ('Étape 8 · Enregistrer et retrouver un match', 8),
           ('Étape 9 · Statistiques et rapports PDF', 9), ("Étape 10 · Utiliser l'appli sans réseau", 10),
           ('Étape 11 · Historique, aide-mémoire et dépannage', 11), ('Étape 12 · Le menu Calendrier', 12),
           ('Annexe A · Module administrateur', 13)]
    s += [TocLine(t, p) for t, p in toc]
    s += [H2('Les boutons à connaître'), P('En haut à droite, une petite barre donne accès à tout, sur chaque écran :', ParagraphStyle('x', parent=body, spaceAfter=4))]
    s += [IconRow('config', 'Configuration', "Créer l'équipe, préparer le match, choisir les joueuses."),
          IconRow('direct', 'Direct', "L'écran du match : chrono, score, saisie des actions."),
          IconRow('stats', 'Statistiques', 'Le tableau des joueuses et les exports PDF.'),
          IconRow('histo', 'Historique', "Toutes les actions dans l'ordre, pour corriger."),
          IconRow(None, 'Calendrier', "Calendrier, résultats et classement des équipes ; stats PDF d'un match.", icon_calendar),
          IconRow(None, 'Administration', "Réservé aux admin : équipes, calendriers, effectifs et accès des coachs.", icon_admin),
          IconRow('save', 'Enregistrer', 'Envoie le match et les statistiques dans la base.')]
    s += [Spacer(1, 0),
          Callout('note', 'Connexion', "À l'ouverture, saisissez l'e-mail et le mot de passe donnés par l'administrateur. Trois profils : "
                  f"{b('superadmin')} (accès illimité), {b('admin')} (toutes les équipes ; gère le club et les comptes) et {b('coach')} "
                  "(seulement les équipes qui lui sont ouvertes ; ne crée pas d'équipe) : voir l'annexe A. Le bouton de déconnexion est en haut à gauche. "
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
         NumItem(2, f"{b('La saison')} : celle en cours par défaut ; la liste permet de revoir une saison passée."),
         NumItem(3, f"{b('La phase')} : {chip('Phase 1', 'yellow')} {chip('Phase 2', 'gray')} {chip('Coupe', 'gray')}… La phase en cours s'ouvre seule. "
                    "La compétition et la poule sont rappelées dessous (ex. Départementale féminine U15 - Division 2 · Poule C)."),
         NumItem(4, f"{b('Deux onglets')} : {chip('Calendrier & résultats', 'yellow')} et {chip('Classement', 'gray')}."),
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

# ================================================================== ANNEXE A : module administrateur
def page_annexe():
    def prof(role, desc): return [Paragraph(role, cellb), Paragraph(desc, cell)]
    t = Table([[Paragraph('Profil', ParagraphStyle('th', fontName='Poppins-Bold', fontSize=8.5, textColor=white)),
                Paragraph('Ce qu\'il permet', ParagraphStyle('th2', fontName='Poppins-Bold', fontSize=8.5, textColor=white))],
               prof('superadmin', "Accès illimité. Fait tout ce que fait l'admin, et seul à pouvoir créer, modifier ou supprimer un compte superadmin."),
               prof('admin', "Voit toutes les équipes. Crée et modifie les équipes, les joueuses, les matchs. Utilise le menu Administration, gère les comptes admin et coach."),
               prof('coach', "Ne voit que les équipes qui lui sont affectées, saison par saison ; peut tout y faire (joueuses, matchs, stats, export, calendrier) sauf créer ou supprimer une équipe."),
               prof('Sans profil', "Peut se connecter mais voit seulement « Accès non autorisé ».")],
              colWidths=[96, CW - 96])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#F1F5F9')]),
                           ('LINEBELOW', (0, 0), (-1, -1), 0.5, LINE), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                           ('LEFTPADDING', (0, 0), (-1, -1), 7)]))
    rows = [("Un coach ne voit aucune équipe", "Vérifiez qu'il a le profil coach et qu'au moins une équipe lui est affectée pour la saison (Administration > Accès). Il doit rouvrir l'appli avec du réseau."),
            ("Une vignette n'a pas d'image", "Ouvrez l'équipe, « Chercher dans les données FFBB » et touchez la bonne image ; on peut aussi coller son adresse api.ffbb.com/assets/…"),
            ("Résultats ou classement pas à jour", "Relancez MiseAJourFFBB_Club.exe depuis un PC, puis « Charger les équipes depuis le cache ». Recharger est sans risque."),
            ("Une équipe manque", "Elle n'a pas de poule dans le cache (pas encore engagée, ou exe non relancé). Le détail du chargement liste les poules ignorées ou en erreur."),
            ("Un match est introuvable par son numéro", "Il n'est pas dans le calendrier de vos équipes : relancez le chargement, ou passez le match en AMICAL."),
            ("Message « permission denied » ou « table introuvable »", "Les scripts SQL de l'installation n'ont pas tous été exécutés (admin_01, admin_03, admin_04), ou le compte n'a pas le profil admin / superadmin.")]
    faq = Table([[Paragraph('Situation', ParagraphStyle('th3', fontName='Poppins-Bold', fontSize=8.5, textColor=white)), Paragraph('Que faire ?', ParagraphStyle('th4', fontName='Poppins-Bold', fontSize=8.5, textColor=white))]]
                + [[Paragraph(a, cellb), Paragraph(b_, cell)] for a, b_ in rows], colWidths=[150, CW - 150])
    faq.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#F1F5F9')]),
                             ('LINEBELOW', (0, 0), (-1, -1), 0.5, LINE), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('LEFTPADDING', (0, 0), (-1, -1), 7)]))
    s = [Banner('A', 'Module administrateur', 'Équipes du club, calendriers, effectifs et accès'),
         P(f"Réservé aux profils {b('admin')} et {b('superadmin')} : le bouton {b('Administration')} (la roue violette, en haut à droite) n'existe pas pour un coach. "
           "Un bandeau d'icônes en haut de l'écran choisit la section : Équipes & calendriers, ou Accès."),
         t, Spacer(1, 4),
         H2('Équipes & calendriers'),
         MockAdmin(), P("Administration > Équipes & calendriers", caption),
         NumItem(1, f"{b('Le bandeau')} : {chip('Équipes & calendriers', 'yellow')} ou {chip('Accès', 'gray')}."),
         NumItem(2, f"{b('Charger les équipes depuis le cache.')} Le site de la FFBB bloque les serveurs : le cache FFBB est rempli par le programme "
                    f"{chip('MiseAJourFFBB_Club.exe', 'blue')} à lancer depuis un PC (le lien est dans l'écran). Le bouton lit ensuite ce cache, "
                    "garde les poules de la saison en cours, repère les équipes d'OLYMPIC SATHONAY et enregistre pour chacune ses phases, son calendrier et son classement. "
                    "Une barre de progression s'affiche ; le détail liste les poules ignorées ou en erreur."),
         NumItem(3, f"{b('Une vignette par équipe')} (U11 F, U13 F, U15 F · équipe 2…), avec l'image FFBB du niveau. L'équipe TeamStats correspondante, "
                    "« SATHONAY U15F - 2026/2027 », est créée automatiquement (ou reprise si elle existe déjà avec ce nom)."),
         NumItem(4, f"{b('Deux onglets par équipe')} : {chip('Effectif', 'yellow')} et {chip('Phases & calendrier', 'gray')}. Les phases s'affichent ainsi : "
                    "« Phase 1 : Départementale féminine U15 - Division 2 - poule C », avec le numéro de phase et de poule FFBB ; "
                    "un toucher sur une phase affiche son calendrier et son classement."),
         NumItem(5, f"{b('Importer un PDF extranet FFBB')} : l'effectif de l'équipe (voir ci-dessous).")]

    s += [PageBreak(), H2('Effectif : importer le trombinoscope de l\'extranet FFBB'),
          MockRoster(), P("Aperçu avant import (les photos ne sont jamais lues)", caption),
          NumItem(1, f"Dans l'extranet FFBB, téléchargez le {b('trombinoscope PDF')} de l'équipe. Dans TeamStats : l'équipe, onglet {chip('Effectif', 'yellow')}, "
                     f"{chip('Importer un PDF extranet FFBB', 'blue')}. Le PDF est lu sur votre appareil : seuls {b('nom, prénom, n° de licence, date de naissance et sexe')} sont gardés, jamais les photos."),
          NumItem(2, f"{b('Affectation')} : chaque personne est rattachée à l'équipe indiquée dans le PDF (« U11 FILLES », n° 1 = U11 F ; n° 2 = U11 F · équipe 2). "
                     "Si l'équipe n'est pas renseignée, c'est la date de naissance qui décide : âge = année de fin de saison - année de naissance "
                     "(10 ou 11 ans : U11 ; 12-13 ans : U13…), à sexe égal."),
          Paragraph("Chaque ligne se corrige avant l'import : décocher, changer d'équipe ou de rôle. Les adultes d'une équipe de jeunes sont proposés en "
                    f"{chip('encadrement', 'gray')}. Un code « D11 » sur la fiche FFBB s'affiche en badge {b('Surclassement U11')} (joueuse U9 qui joue en U11).",
                    ParagraphStyle('ind', parent=body, leftIndent=25.5)),
          NumItem(2 + 1, f"{chip('Importer', 'green')} : réimporter est sans risque (une personne = une ligne par équipe, clé : n° de licence). "
                         "L'option « retirer de l'équipe les personnes absentes de ce PDF » est décochée par défaut. Dans la liste, on peut changer une personne d'équipe, de rôle, ou la retirer."),
          Callout('note', 'Données personnelles', "Noms, licences et dates de naissance de mineurs : l'effectif n'est lisible que par les admin et par les comptes affectés à l'équipe. "
                  "Il est distinct de la liste des joueuses saisie à l'étape 1."),
          H2('Accès : comptes et équipes des coachs'),
          NumItem(1, f"{chip('Nouveau compte', 'blue')} : e-mail, nom affiché, mot de passe (le bouton {chip('Générer', 'gray')} en propose un) et profil. "
                     f"{b('Notez le mot de passe maintenant')} : il ne s'affiche plus ensuite. Le compte est actif tout de suite."),
          NumItem(2, f"{b('Modifier un compte')} : touchez la ligne de la personne. Changez le nom, le {b('profil')} (coach, admin…), éventuellement le mot de passe, "
                     f"puis touchez {chip('Enregistrer', 'green')} : rien n'est modifié avant. Un compte « sans profil » peut se connecter mais ne voit rien."),
          NumItem(3, f"{b('Affecter des équipes à un coach')} : donnez-lui d'abord le profil {chip('coach', 'blue')} et enregistrez. La liste « Équipes affectées » apparaît : "
                     "choisissez la saison, puis touchez une ou plusieurs vignettes (une coche verte = équipe ouverte ; un nouveau toucher la retire). "
                     "Exemple : U13 F en 2025-2026, U15 F ou U15 M en 2026-2027. L'affectation est immédiate et ouvre aussi l'équipe dans le direct et les statistiques."),
          NumItem(4, f"{b('Désactiver')} un compte (la personne ne peut plus se connecter) ou le {b('supprimer')} : boutons en bas de la fiche. Un admin ou un superadmin voit toutes les équipes : rien à affecter."),
          Callout('note', 'Qui peut modifier qui ?', "Un admin gère les comptes admin et coach ; seul le superadmin gère les superadmin. "
                  "Personne ne peut changer son propre rôle, se désactiver ou se supprimer."),
          PageBreak(), H2('Installation (une seule fois, par la personne qui gère la base)'),
          NumItem(1, f"Dans l'éditeur SQL de Supabase, exécutez dans l'ordre : {chip('security_01', 'gray')} (profils et règles), {chip('admin_01_club_calendar', 'gray')} "
                     f"(superadmin, équipes, calendriers), {chip('admin_03_roster', 'gray')} (effectifs), puis {chip('admin_04_role_coach', 'gray')} si des comptes existaient déjà "
                     "avec l'ancien profil « analyst » (il devient « coach », droits inchangés)."),
          NumItem(2, "Désignez le premier superadmin : la requête est à la fin de admin_01_club_calendar.sql (une ligne, avec votre adresse e-mail)."),
          NumItem(3, "Sur Vercel (Settings > Environment Variables), ajoutez SUPABASE_SERVICE_ROLE_KEY (la clé « service_role » de Supabase, Project Settings > API) : "
                     "elle sert à lister et créer les comptes. Elle ne doit jamais être partagée."),
          Callout('warn', "À faire une fois : fermer l'inscription libre.", "Supabase, Authentication, Sign In / Providers : désactivez « Allow new users to sign up ». "
                  "Les comptes se créent désormais depuis Administration > Accès."),
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
    w.add_page(base.pages[0])                                       # couverture (inchangée)
    for p in build(page_accueil(), 1).pages: w.add_page(p)          # accueil / programme (reconstruit)
    patches = {2: patch_page3, 3: patch_page4, 8: patch_page9}      # index dans le PDF d'origine
    for i in range(2, 12):                                          # étapes 1 à 11 (pages d'origine)
        pg = base.pages[i]
        if i in patches: pg.merge_page(overlay(i, patches[i]))
        w.add_page(pg)
    for p in build(page_calendrier(), 12).pages: w.add_page(p)      # étape 12
    for p in build(page_annexe(), 13).pages: w.add_page(p)          # annexe A
    w.add_metadata({'/Title': "TeamStats - Mode d'emploi", '/Author': 'Olympic Sathonay', '/Subject': 'Suivi de match et statistiques'})
    with open(OUT, 'wb') as f: w.write(f)
    print('pages :', len(w.pages))

if __name__ == '__main__':
    main()
