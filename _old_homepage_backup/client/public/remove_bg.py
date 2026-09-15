import cv2
import numpy as np

# Load the image
img_path = "new_logo.jpg"
out_path = "822logo_final_v3.png"

# Read image with alpha channel if possible, else BGR
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)

if img.shape[2] == 3:
    # Convert to BGRA
    img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)

# Convert to grayscale to find white background
gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)

# Threshold: pixels > 240 are considered background
_, mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)

# To handle anti-aliasing around text, let's blur the mask slightly and use it as an inverse alpha
mask_inv = cv2.bitwise_not(mask)

# For soft edges, we can use the grayscale image directly as alpha for the white parts?
# No, because gray parts (like the taeguk) would become semi-transparent.
# Instead, let's create a soft mask based on how close a pixel is to white.
# Distance to white:
# white is [255, 255, 255]
# distance = 255 - gray
# but we only want to make white transparent. 
# So let's just make the mask a bit softer.
mask_blur = cv2.GaussianBlur(mask_inv, (3, 3), 0)

# Set alpha channel
# Any pixel that was completely white in 'mask' will have 0 in 'mask_inv'
# We will use the mask_inv as the alpha channel, but boost it so that grays and blacks stay fully opaque
# Anything below 240 in grayscale should be fully opaque.
alpha = np.where(gray < 235, 255, mask_inv)

img[:, :, 3] = alpha

# Also, for pixels that are partially transparent, their color might be mixed with white, 
# resulting in white halos on dark backgrounds. 
# Let's change the color of near-white transparent pixels to black to avoid white halos.
# If alpha is < 255, we can darken the RGB channels.
# A simple way:
for i in range(3):
    img[:, :, i] = np.where(alpha < 255, 0, img[:, :, i])

cv2.imwrite(out_path, img)
print("Background removed and saved to", out_path)
