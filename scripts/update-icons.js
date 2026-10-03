const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ICONS_DIR = path.join(__dirname, "../src/components/icons");
const CACHE_FILE = path.join(__dirname, ".icon-update-cache.json");

/**
 * Calculate file hash for cache comparison
 */
function calculateFileHash(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Load cache from file
 */
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheContent = fs.readFileSync(CACHE_FILE, "utf8");
      return JSON.parse(cacheContent);
    }
  } catch (error) {
    console.warn("⚠️  Warning: Could not load cache file, starting fresh");
  }
  return {};
}

/**
 * Save cache to file
 */
function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (error) {
    console.warn("⚠️  Warning: Could not save cache file:", error.message);
  }
}

/**
 * Check if file needs update based on cache
 */
function needsUpdate(filePath, fileName, cache) {
  // If file not in cache, it needs update
  if (!cache[fileName]) {
    return true;
  }

  // If file hash changed, it needs update
  const currentHash = calculateFileHash(filePath);
  if (cache[fileName].hash !== currentHash) {
    return true;
  }

  // File already processed and hasn't changed
  return false;
}

/**
 * Extract all color values from SVG content
 * Returns a Set of unique color values
 */
function extractColors(svgContent) {
  const colors = new Set();

  // Match fill attributes: fill="#color" or fill="color"
  const fillMatches = svgContent.match(/fill=["']([^"']+)["']/g);
  if (fillMatches) {
    fillMatches.forEach((match) => {
      const color = match.match(/fill=["']([^"']+)["']/)[1];
      if (color && color !== "none" && color !== "currentColor") {
        colors.add(color);
      }
    });
  }

  // Match stroke attributes: stroke="#color" or stroke="color"
  const strokeMatches = svgContent.match(/stroke=["']([^"']+)["']/g);
  if (strokeMatches) {
    strokeMatches.forEach((match) => {
      const color = match.match(/stroke=["']([^"']+)["']/)[1];
      if (color && color !== "none" && color !== "currentColor") {
        colors.add(color);
      }
    });
  }

  return colors;
}

/**
 * Replace all occurrences of a color with currentColor
 */
function replaceColorWithCurrentColor(svgContent, color) {
  // Replace fill="color" or fill='color'
  svgContent = svgContent.replace(
    new RegExp(
      `fill=["']${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "g"
    ),
    'fill="currentColor"'
  );

  // Replace stroke="color" or stroke='color'
  svgContent = svgContent.replace(
    new RegExp(
      `stroke=["']${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "g"
    ),
    'stroke="currentColor"'
  );

  return svgContent;
}

/**
 * Update a single SVG file
 */
function updateIconFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, "utf8");
    let updated = false;

    // Update width="16" to width="1em"
    if (content.includes('width="16"')) {
      content = content.replace(/width=["']16["']/g, 'width="1em"');
      updated = true;
    }

    // Update height="16" to height="1em"
    if (content.includes('height="16"')) {
      content = content.replace(/height=["']16["']/g, 'height="1em"');
      updated = true;
    }

    // Extract all colors
    const colors = extractColors(content);

    // If there's exactly one unique color, replace it with currentColor
    if (colors.size === 1) {
      const color = Array.from(colors)[0];
      content = replaceColorWithCurrentColor(content, color);
      updated = true;
    }

    // Write back if updated
    if (updated) {
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Error updating ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Update all icon files
 */
function updateAllIcons() {
  try {
    // Load cache
    const cache = loadCache();

    // Read all files in icons directory
    const files = fs.readdirSync(ICONS_DIR);

    // Filter only SVG files, exclude trader-range icons
    const svgFiles = files.filter(
      (file) => file.endsWith(".svg") && !file.startsWith("trader-range-")
    );

    if (svgFiles.length === 0) {
      console.log("⚠️  No SVG files found in icons directory");
      return;
    }

    console.log(`📝 Processing ${svgFiles.length} icon files...\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let cachedCount = 0;

    svgFiles.forEach((file) => {
      const filePath = path.join(ICONS_DIR, file);

      // Check if file needs update
      if (!needsUpdate(filePath, file, cache)) {
        cachedCount++;
        console.log(`💾 Cached: ${file} (already processed)`);
        return;
      }

      const wasUpdated = updateIconFile(filePath);

      if (wasUpdated) {
        updatedCount++;
        // Update cache with new hash
        const newHash = calculateFileHash(filePath);
        cache[file] = {
          hash: newHash,
          updatedAt: new Date().toISOString(),
        };
        console.log(`✅ Updated: ${file}`);
      } else {
        skippedCount++;
        // Update cache even if no changes (file already in correct format)
        const currentHash = calculateFileHash(filePath);
        cache[file] = {
          hash: currentHash,
          updatedAt: new Date().toISOString(),
        };
        console.log(`⏭️  Skipped: ${file} (no changes needed)`);
      }
    });

    // Save cache
    saveCache(cache);

    console.log(`\n✨ Done!`);
    console.log(`   - Updated: ${updatedCount} files`);
    console.log(`   - Skipped: ${skippedCount} files`);
    console.log(`   - Cached: ${cachedCount} files`);
    console.log(`   - Total: ${svgFiles.length} files`);
  } catch (error) {
    console.error("❌ Error updating icons:", error.message);
    process.exit(1);
  }
}

// Run the script
updateAllIcons();
