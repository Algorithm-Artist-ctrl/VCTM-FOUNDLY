from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
OUT = "VCTM-Foundly-demo.gif"
scenes = [
    ("VIVEKANANDA COLLEGE OF TECHNOLOGY & MANAGEMENT", "VCTM Foundly", "A safe campus space for lost items to find their way home.", "01", "#ee715e"),
    ("LOST ITEM REPORT", "Aarav loses his backpack", "He signs in with his VCTM account and reports the item with location and details.", "02", "#ee715e"),
    ("FOUND ITEM REPORT", "Meera finds a backpack", "She posts where she found it, without sharing personal contact details.", "03", "#427d68"),
    ("SMART MATCHING", "A possible match is found", "Foundly compares the item name, category and location to suggest a 96% match.", "04", "#7b68d4"),
    ("SAFE CONNECTION", "Aarav sends a request", "He explains why the backpack is his. Meera can accept or decline the request.", "05", "#ee715e"),
    ("VERIFIED HANDOFF", "Meera accepts the request", "Both verified VCTM members arrange a safe return at the Student Centre.", "06", "#427d68"),
    ("ITEM RETURNED", "Backpack reunited with Aarav", "One report, one safe connection, one happy reunion.", "✓", "#427d68"),
]
font_paths = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"]
bold_paths = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"]
def font(paths, size):
    for path in paths:
        try: return ImageFont.truetype(path, size)
        except OSError: pass
    return ImageFont.load_default()
regular, bold = lambda n: font(font_paths,n), lambda n: font(bold_paths,n)

def wrap(draw, text, fnt, max_width):
    words, lines, line = text.split(), [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textbbox((0,0), candidate, font=fnt)[2] > max_width and line:
            lines.append(line); line = word
        else: line = candidate
    return lines + [line]

frames=[]
for kicker,title,body,step,accent in scenes:
    for phase in (0,1):
        im=Image.new("RGB",(W,H),"#f7f5f0"); d=ImageDraw.Draw(im)
        d.rectangle((0,0,480,H),fill="#14233b")
        d.rounded_rectangle((50,48,84,82),radius=10,fill=accent); d.text((61,50),"F",font=bold(24),fill="white")
        d.text((96,50),"VCTM Foundly",font=bold(25),fill="white")
        d.text((60,175),kicker,font=regular(14),fill="#c3d0df")
        y=240
        for line in wrap(d,title,bold(47),360): d.text((60,y),line,font=bold(47),fill="white"); y+=56
        y=465
        for line in wrap(d,body,regular(20),355): d.text((60,y),line,font=regular(20),fill="#c8d3e0"); y+=32
        # right visual: a simple report card plus backpack
        d.ellipse((850,120,1160,430),fill=accent)
        d.rounded_rectangle((690,180,925,480),radius=22,fill="white",outline="#e6e2da",width=2)
        d.rounded_rectangle((715,210,900,270),radius=10,fill="#eef1f2")
        d.rounded_rectangle((748,310,870,403),radius=14,fill="#223244")
        d.arc((775,280,843,345),180,360,fill="#223244",width=10)
        d.rounded_rectangle((780,340,838,382),radius=8,fill=accent)
        d.text((1010,246),step,font=bold(84),fill="white")
        d.text((690,590),"REPORT  •  MATCH  •  CONNECT  •  RETURN",font=regular(14),fill="#627185")
        if phase: d.rectangle((0,0,W,H),fill="#ffffff")
        frames.append(im)
frames[0].save(OUT,save_all=True,append_images=frames[1:],duration=[2400,120]*len(scenes),loop=0,disposal=2)
print(OUT)
