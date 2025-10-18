from PIL import Image, ImageDraw
import math

# Create a larger image for better quality
size = 200
img = Image.new('RGBA', (size, int(size * 1.4)), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Pin dimensions
center_x = size // 2
top_y = 10
circle_radius = size // 3
point_y = int(size * 1.3)

# Draw shadow (subtle)
shadow_offset = 5
shadow_ellipse = [(center_x - 25 + shadow_offset, point_y - 10), 
                  (center_x + 25 + shadow_offset, point_y)]
draw.ellipse(shadow_ellipse, fill=(0, 0, 0, 60))

# Draw outer glow
glow_radius = circle_radius + 15
glow_box = [(center_x - glow_radius, top_y + circle_radius - glow_radius),
            (center_x + glow_radius, top_y + circle_radius + glow_radius)]
draw.ellipse(glow_box, fill=(255, 59, 48, 40))

# Draw main pin body (gradient effect with multiple circles)
for i in range(20, 0, -1):
    alpha = int(255 * (i / 20))
    color_r = int(255 - (i * 10))
    color_g = int(59 - (i * 2))
    color_b = 48
    
    # Top circle part
    offset = i * 0.5
    circle_box = [(center_x - circle_radius + offset, top_y + circle_radius - circle_radius + offset),
                  (center_x + circle_radius - offset, top_y + circle_radius + circle_radius - offset)]
    draw.ellipse(circle_box, fill=(color_r, color_g, color_b, alpha))

# Draw pin point (teardrop shape)
points = []
for angle in range(-90, 91, 5):
    rad = math.radians(angle)
    x = center_x + circle_radius * 0.9 * math.cos(rad)
    y = top_y + circle_radius + circle_radius * 0.9 * math.sin(rad)
    points.append((x, y))
points.append((center_x, point_y))
draw.polygon(points, fill=(211, 47, 47, 255))

# Draw main circle
circle_box = [(center_x - circle_radius, top_y),
              (center_x + circle_radius, top_y + circle_radius * 2)]
draw.ellipse(circle_box, fill=(255, 59, 48, 255))

# Draw inner white circle
inner_radius = circle_radius * 0.5
inner_box = [(center_x - inner_radius, top_y + circle_radius - inner_radius),
             (center_x + inner_radius, top_y + circle_radius + inner_radius)]
draw.ellipse(inner_box, fill=(255, 255, 255, 240))

# Draw center red dot
dot_radius = circle_radius * 0.25
dot_box = [(center_x - dot_radius, top_y + circle_radius - dot_radius),
           (center_x + dot_radius, top_y + circle_radius + dot_radius)]
draw.ellipse(dot_box, fill=(255, 59, 48, 255))

# Draw highlight shine
shine_center_x = center_x - circle_radius * 0.3
shine_center_y = top_y + circle_radius * 0.6
shine_radius_x = circle_radius * 0.4
shine_radius_y = circle_radius * 0.5
shine_box = [(shine_center_x - shine_radius_x, shine_center_y - shine_radius_y),
             (shine_center_x + shine_radius_x, shine_center_y + shine_radius_y)]
draw.ellipse(shine_box, fill=(255, 255, 255, 60))

# Save the image
img.save('/Users/princekumar/Documents/code/rnmapbox-pins/assets/modern-pin.png')
print("Pin created successfully!")
