//investigation-boards.js

import { registerSettings } from "./settings.js";

const MODULE_ID = "investigation-board";
const BASE_FONT_SIZE = 15;
const PIN_COLORS = ["redPin.webp", "bluePin.webp", "yellowPin.webp", "greenPin.webp"];
let positionManager = null;

function getBaseCharacterLimits() {
  return game.settings.get(MODULE_ID, "baseCharacterLimits") || {
    sticky: 60,
    photo: 15,
    index: 200,
  };
}

function getDynamicCharacterLimits(noteType, currentFontSize) {
  const baseLimits = getBaseCharacterLimits();
  const scaleFactor = BASE_FONT_SIZE / currentFontSize;
  const limits = baseLimits[noteType] || { sticky: 60, photo: 15, index: 200 };
  return {
    sticky: Math.round(limits.sticky * scaleFactor),
    photo: Math.round(limits.photo * scaleFactor),
    index: Math.round(limits.index * scaleFactor),
  };
}

// Position Management System for tracking and syncing note positions and properties
class NotePositionManager {
  constructor() {
    this.positions = {};
    this.setupHooks();
    this.setupSockets();
    this.loadPositions();
  }
  
  setupHooks() {
    Hooks.on("updateDrawing", this.onNoteUpdate.bind(this));
    Hooks.on("createDrawing", this.onNoteCreate.bind(this));
    Hooks.on("deleteDrawing", this.onNoteDelete.bind(this));
    Hooks.on("canvasReady", this.loadPositions.bind(this));
  }
  
  setupSockets() {
    if (game.modules.get("socketlib")?.active) {
      this.socket = socketlib.registerModule(MODULE_ID);
      this.socket.register("updateNotePosition", this.onExternalPositionUpdate.bind(this));
      console.log(`${MODULE_ID} | Socket communication initialized for collaborative editing`);
    } else {
      console.warn(`${MODULE_ID} | SocketLib not available, collaborative position tracking disabled`);
    }
  }
  
  // Handle position updates from other users via socket
  onExternalPositionUpdate(data) {
    // Update our local positions cache
    if (data.id && data.position) {
      this.positions[data.id] = data.position;
      this.emit("positionsUpdated", this.positions);
      
      // Refresh the drawing if it exists on canvas
      const drawing = canvas.drawings.get(data.id);
      if (drawing) drawing.refresh();
    }
  }
  
  // Load saved positions from the current scene
  async loadPositions() {
    if (!canvas.scene) return;
    
    const savedPositions = canvas.scene.getFlag(MODULE_ID, "notePositions") || {};
    this.positions = savedPositions;
    
    // Update any existing drawings with their saved positions
    for (const [id, position] of Object.entries(this.positions)) {
      const drawing = canvas.drawings.get(id);
      if (drawing) {
        // Create an update object with all the saved data
        const updateData = {};
        
        // Position and transform properties
        if (position.x !== undefined && drawing.x !== position.x) updateData.x = position.x;
        if (position.y !== undefined && drawing.y !== position.y) updateData.y = position.y;
        if (position.rotation !== undefined && drawing.rotation !== position.rotation) updateData.rotation = position.rotation;
        if (position.z !== undefined && drawing.z !== position.z) updateData.z = position.z;
        
        // Shape properties
        if (position.width !== undefined && drawing.shape?.width !== position.width) {
          updateData["shape.width"] = position.width;
        }
        if (position.height !== undefined && drawing.shape?.height !== position.height) {
          updateData["shape.height"] = position.height;
        }
        
        // Scale properties
        if (position.scaleX !== undefined && drawing.transform?.scaleX !== position.scaleX) {
          updateData["transform.scaleX"] = position.scaleX;
        }
        if (position.scaleY !== undefined && drawing.transform?.scaleY !== position.scaleY) {
          updateData["transform.scaleY"] = position.scaleY;
        }
        
        // Investigation Board specific properties
        if (position.type !== undefined && drawing.flags[MODULE_ID]?.type !== position.type) {
          updateData[`flags.${MODULE_ID}.type`] = position.type;
        }
        if (position.text !== undefined && drawing.flags[MODULE_ID]?.text !== position.text) {
          updateData[`flags.${MODULE_ID}.text`] = position.text;
        }
        if (position.image !== undefined && drawing.flags[MODULE_ID]?.image !== position.image) {
          updateData[`flags.${MODULE_ID}.image`] = position.image;
        }
        if (position.pinColor !== undefined && drawing.flags[MODULE_ID]?.pinColor !== position.pinColor) {
          updateData[`flags.${MODULE_ID}.pinColor`] = position.pinColor;
        }
        if (position.identityName !== undefined && drawing.flags[MODULE_ID]?.identityName !== position.identityName) {
          updateData[`flags.${MODULE_ID}.identityName`] = position.identityName;
        }
        
        // Only perform the update if there are actually changes
        if (Object.keys(updateData).length > 0) {
          await drawing.document.update(updateData, { noSocket: true });
        }
      }
    }
    
    this.emit("positionsLoaded", this.positions);
  }
  
  onNoteUpdate(document, updateData, options, userId) {
    // Skip if this is a socket-triggered update to avoid loops
    if (options.noSocket) return;
    
    if (document.flags[MODULE_ID]) {
      // Check for ANY position or property changes
      const hasPositionChange = updateData.x !== undefined || 
                                updateData.y !== undefined ||
                                updateData.rotation !== undefined ||
                                updateData.z !== undefined ||
                                updateData.transform?.scaleX !== undefined ||
                                updateData.transform?.scaleY !== undefined;
                                
      const hasShapeChange = updateData.shape?.width !== undefined || 
                             updateData.shape?.height !== undefined;
      
      // Check for changes to Investigation Board specific properties
      const hasFlagChanges = updateData.flags?.[MODULE_ID]?.type !== undefined ||
                             updateData.flags?.[MODULE_ID]?.text !== undefined ||
                             updateData.flags?.[MODULE_ID]?.image !== undefined ||
                             updateData.flags?.[MODULE_ID]?.pinColor !== undefined ||
                             updateData.flags?.[MODULE_ID]?.identityName !== undefined;
      
      if (hasPositionChange || hasShapeChange || hasFlagChanges) {
        this.updatePosition(document, userId);
      }
    }
  }
  
  onNoteCreate(document, options, userId) {
    if (document.flags[MODULE_ID]) {
      this.updatePosition(document, userId);
    }
  }
  
  onNoteDelete(document, options, userId) {
    if (document.flags[MODULE_ID] && this.positions[document.id]) {
      delete this.positions[document.id];
      this.savePositions();
      this.emit("positionsUpdated", this.positions);
      
      // Broadcast the deletion
      if (this.socket && game.user.id === userId) {
        this.socket.executeForOthers("updateNotePosition", {
          id: document.id,
          position: null // null indicates deletion
        });
      }
    }
  }
  
  async updatePosition(document, userId) {
    // Create a comprehensive position object with ALL note data
    const position = {
      // Basic Foundry positioning data
      id: document.id,
      x: document.x,
      y: document.y,
      rotation: document.rotation || 0,
      z: document.z || 0,
      width: document.shape?.width,
      height: document.shape?.height,
      scaleX: document.transform?.scaleX || 1,
      scaleY: document.transform?.scaleY || 1,
      
      // Investigation Board specific data
      type: document.flags[MODULE_ID]?.type || "sticky",
      text: document.flags[MODULE_ID]?.text || "",
      image: document.flags[MODULE_ID]?.image || "",
      pinColor: document.flags[MODULE_ID]?.pinColor || "",
      identityName: document.flags[MODULE_ID]?.identityName || "",
      
      updated: Date.now()
    };
    
    // Update our local cache
    this.positions[document.id] = position;
    
    // Save to scene flags for persistence
    await this.savePositions();
    
    // Trigger any callbacks
    this.emit("positionsUpdated", this.positions);
    
    // Broadcast to other users if this user made the change
    if (this.socket && game.user.id === userId) {
      this.socket.executeForOthers("updateNotePosition", {
        id: document.id,
        position: position
      });
    }
  }
  
  async savePositions() {
    if (!canvas.scene) return;
    
    try {
      await canvas.scene.setFlag(MODULE_ID, "notePositions", this.positions);
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving note positions:`, error);
    }
  }
  
  getAllPositions() {
    return this.positions;
  }
  
  getPosition(id) {
    return this.positions[id] || null;
  }
  
  // Get all notes of a specific type
  getNotesByType(type) {
    return Object.values(this.positions).filter(pos => pos.type === type);
  }
  
  // Get all notes with a specific pin color
  getNotesByPinColor(pinColor) {
    return Object.values(this.positions).filter(pos => pos.pinColor === pinColor);
  }
  
  // Find notes containing specific text
  searchNotesByText(searchText) {
    return Object.values(this.positions).filter(pos => 
      pos.text && pos.text.toLowerCase().includes(searchText.toLowerCase())
    );
  }
  
  // Find the nearest note to a specific position
  findNearestNote(x, y, maxDistance = 100) {
    let nearest = null;
    let minDistance = maxDistance;
    
    for (const pos of Object.values(this.positions)) {
      const dx = pos.x - x;
      const dy = pos.y - y;
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      if (distance < minDistance) {
        minDistance = distance;
        nearest = pos;
      }
    }
    
    return nearest;
  }
  
  // For debugging - log all current positions
  logPositions() {
    console.log(`${MODULE_ID} | Current Note Positions:`, this.positions);
  }
  
  // Simple event system
  callbacks = {};
  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
    return this; // Allow chaining
  }
  
  off(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
    }
    return this; // Allow chaining
  }
  
  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => callback(data));
    }
    return this; // Allow chaining
  }
}

// Function to show positions dialog for debugging or management
function showPositionsDialog() {
  if (!positionManager) return;
  
  const positions = positionManager.getAllPositions();
  
  let content = `<h2>Investigation Board Notes</h2>
                <table style="width:100%">
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Text</th>
                    <th>Position</th>
                    <th>Size</th>
                    <th>Image</th>
                    <th>Pin</th>
                  </tr>`;
  
  for (const [id, pos] of Object.entries(positions)) {
    const imagePreview = pos.image ? 
      `<img src="${pos.image}" width="50" height="50" title="${pos.image}"/>` : 
      "None";
    
    const pinInfo = pos.pinColor ? 
      `<img src="modules/investigation-board/assets/${pos.pinColor}" width="20" height="20"/>` : 
      "None";
    
    content += `<tr>
                  <td>${id.substring(0, 8)}...</td>
                  <td>${pos.type}</td>
                  <td>${pos.text?.substring(0, 15) || ''}${pos.text?.length > 15 ? '...' : ''}</td>
                  <td>X:${Math.round(pos.x)}, Y:${Math.round(pos.y)}</td>
                  <td>${Math.round(pos.width)}×${Math.round(pos.height)}</td>
                  <td>${imagePreview}</td>
                  <td>${pinInfo}</td>
                </tr>`;
  }
  
  content += `</table>`;
  
  new Dialog({
    title: "Investigation Board - Note Positions",
    content: content,
    buttons: {
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: "Close"
      },
      export: {
        icon: '<i class="fas fa-file-export"></i>',
        label: "Export JSON",
        callback: () => {
          // Create a download with the positions data
          const dataStr = JSON.stringify(positions, null, 2);
          const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
          
          const exportName = `investigation-board-positions-${canvas.scene.name}-${new Date().toISOString().slice(0, 10)}.json`;
          
          const linkElement = document.createElement('a');
          linkElement.setAttribute('href', dataUri);
          linkElement.setAttribute('download', exportName);
          linkElement.click();
        }
      }
    },
    default: "close",
    width: 500
  }).render(true);
}

class CustomDrawingSheet extends DrawingConfig {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["custom-drawing-sheet"],
      template: "modules/investigation-board/templates/drawing-sheet.html",
      width: 400,
      height: "auto",
      title: "Note Configuration",
    });
  }

  getData(options) {
    const data = super.getData(options);
    data.noteType = this.object.flags[MODULE_ID]?.type || "sticky";
    data.text = this.object.flags[MODULE_ID]?.text || "Default Text";
    data.image = this.object.flags[MODULE_ID]?.image || "modules/investigation-board/assets/placeholder.webp";
    
    // Pass along the extra identityName for futuristic photo notes
    data.identityName = this.object.flags[MODULE_ID]?.identityName || "";
    
    // Include the board mode from settings for conditional display in the template
    data.boardMode = game.settings.get(MODULE_ID, "boardMode");
    
    data.noteTypes = {
      sticky: "Sticky Note",
      photo: "Photo Note",
      index: "Index Card",
    };
    return data;
  }
  

  async _updateObject(event, formData) {
    const updates = {
      [`flags.${MODULE_ID}.type`]: formData.noteType,
      [`flags.${MODULE_ID}.text`]: formData.text,
      [`flags.${MODULE_ID}.image`]: formData.image || "modules/investigation-board/assets/placeholder.webp",
    };
    if (formData.identityName !== undefined) {
      updates[`flags.${MODULE_ID}.identityName`] = formData.identityName;
    }
    

    await this.object.update(updates);
    const drawing = canvas.drawings.get(this.object.id);
    if (drawing) drawing.refresh();
  }

  // Add activateListeners to hook up the file-picker button.
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".file-picker-button").click(ev => {
      ev.preventDefault();
      // Open Foundry's FilePicker for images; adjust the "current" directory if needed.
      new FilePicker({
        type: "image",
        current: "modules/investigation-board/assets/",
        callback: path => {
          // Update the readonly input with the chosen image path.
          html.find("input[name='image']").val(path);
        }
      }).browse();
    });
  }
}

class CustomDrawing extends Drawing {
  constructor(...args) {
    super(...args);
    this.bgSprite = null;
    this.pinSprite = null;
    this.noteText = null;
    this.photoImageSprite = null;
    this.identityNameText = null;
    this.futuristicText = null;
  }

  // Ensure sprites are created when the drawing is first rendered.
  async draw() {
    await super.draw();
    await this._updateSprites();
    return this;
  }

  // Ensure sprites update correctly on refresh.
  async refresh() {
    await super.refresh();
    await this._updateSprites();
    return this;
  }

  async _updateSprites() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return;
    
    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";
    const mode = game.settings.get(MODULE_ID, "boardMode");
    
    // FUTURISTIC PHOTO NOTE LAYOUT
    if (isPhoto && mode === "futuristic") {
      const fullWidth = game.settings.get(MODULE_ID, "photoNoteWidth");
      const margin = 10;
      const photoImgWidth = fullWidth * 0.4;
      const photoImgHeight = photoImgWidth * (4 / 3);
      const textAreaX = margin + photoImgWidth + margin;
      const fullHeight = photoImgHeight + margin * 2;
    
      // --- Background Frame ---
      if (!this.bgSprite) {
        this.bgSprite = new PIXI.Sprite();
        this.addChildAt(this.bgSprite, 0);
      }
      try {
        // Always use the fixed photo frame image.
        this.bgSprite.texture = PIXI.Texture.from("modules/investigation-board/assets/photoFrame.webp");
      } catch (err) {
        console.error("Failed to load photo frame texture", err);
        this.bgSprite.texture = PIXI.Texture.EMPTY;
      }
      this.bgSprite.width = fullWidth;
      this.bgSprite.height = fullHeight;
    
      // --- Foreground (User-Assigned) Photo ---
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        // Use a fallback if no image is assigned.
        const imagePath = noteData.image || "modules/investigation-board/assets/placeholder.webp";
        this.photoImageSprite.texture = PIXI.Texture.from(imagePath);
      } catch (err) {
        console.error(`Failed to load user photo: ${noteData.image}`, err);
        this.photoImageSprite.texture = PIXI.Texture.EMPTY;
      }
      // Position the user photo inside the frame.
      this.photoImageSprite.width = fullWidth * 0.9;
      this.photoImageSprite.height = fullHeight * 0.9;
      this.photoImageSprite.position.set(fullWidth * 0.05, fullHeight * 0.05);
    
      // --- Identity Name and Additional Text (Futuristic) ---
      const font = game.settings.get(MODULE_ID, "font");
      const baseFontSize = game.settings.get(MODULE_ID, "baseFontSize");
      const fontSize = (fullWidth / 200) * baseFontSize;
      const textStyle = new PIXI.TextStyle({
        fontFamily: font,
        fontSize: fontSize,
        fill: "#000000",
        wordWrap: true,
        wordWrapWidth: fullWidth - textAreaX - margin,
        align: "left",
      });
      if (!this.identityNameText) {
        this.identityNameText = new PIXI.Text("", textStyle);
        this.addChild(this.identityNameText);
      }
      this.identityNameText.text = noteData.identityName || "Name";
      this.identityNameText.style = textStyle;
      this.identityNameText.position.set(textAreaX, margin);
    
      if (!this.futuristicText) {
        this.futuristicText = new PIXI.Text("", textStyle);
        this.addChild(this.futuristicText);
      }
      this.futuristicText.text = noteData.text || "";
      this.futuristicText.style = textStyle;
      this.futuristicText.position.set(textAreaX, margin + this.identityNameText.height + 5);
    
      // Remove default note text if present.
      if (this.noteText) {
        this.removeChild(this.noteText);
        this.noteText.destroy();
        this.noteText = null;
      }
    
      // --- Pin Handling (Futuristic) ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          if (this.document.isOwner) {
            await this.document.update({ [`flags.${MODULE_ID}.pinColor`]: pinColor });
          }
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          this.pinSprite.texture = PIXI.Texture.from(pinImage);
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          this.pinSprite.texture = PIXI.Texture.EMPTY;
        }
        this.pinSprite.width = 40;
        this.pinSprite.height = 40;
        this.pinSprite.position.set(fullWidth / 2 - 20, 3);
      }
      return; // End early for futuristic photo notes.
    }
    
    // STANDARD LAYOUT (Modern photo notes, sticky, index, etc.)
    const width = isPhoto
      ? game.settings.get(MODULE_ID, "photoNoteWidth")
      : isIndex
        ? game.settings.get(MODULE_ID, "indexNoteWidth") || 600
        : game.settings.get(MODULE_ID, "stickyNoteWidth");
    
    const height = isPhoto
      ? Math.round(width / (225 / 290))
      : isIndex
        ? Math.round(width / (600 / 400))
        : width;
    
    // Background Image based on board mode.
    const getBackgroundImage = (noteType, mode) => {
      if (mode === "futuristic") {
        if (noteType === "photo") return "modules/investigation-board/assets/futuristic_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/futuristic_note_index.webp";
        return "modules/investigation-board/assets/futuristic_note_white.webp";
      } else if (mode === "custom") {
        if (noteType === "photo") return "modules/investigation-board/assets/custom_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/custom_note_index.webp";
        return "modules/investigation-board/assets/custom_note_white.webp";
      }
      // Default "modern" mode:
      if (noteType === "photo") return "modules/investigation-board/assets/photoFrame.webp";
      if (noteType === "index") return "modules/investigation-board/assets/note_index.webp";
      return "modules/investigation-board/assets/note_white.webp";
    };
    const bgImage = getBackgroundImage(noteData.type, mode);
    
    if (!this.bgSprite) {
      this.bgSprite = new PIXI.Sprite();
      this.addChild(this.bgSprite);
    }
    try {
      this.bgSprite.texture = PIXI.Texture.from(bgImage);
    } catch (err) {
      console.error(`Failed to load background texture: ${bgImage}`, err);
      this.bgSprite.texture = PIXI.Texture.EMPTY;
    }
    this.bgSprite.width = width;
    this.bgSprite.height = height;
    
    // --- Foreground (User-Assigned) Photo for Modern Mode ---
    if (isPhoto) {
      const fgImage = noteData.image || "modules/investigation-board/assets/placeholder.webp";
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        this.photoImageSprite.texture = PIXI.Texture.from(fgImage);
      } catch (err) {
        console.error(`Failed to load foreground texture: ${fgImage}`, err);
        this.photoImageSprite.texture = PIXI.Texture.EMPTY;
      }
      // Use offsets similar to your old code.
      const widthOffset = width * 0.13333;
      const heightOffset = height * 0.30246;
      this.photoImageSprite.width = width - widthOffset;
      this.photoImageSprite.height = height - heightOffset;
      this.photoImageSprite.position.set(widthOffset / 2, heightOffset / 2);
      this.photoImageSprite.visible = true;
    } else if (this.photoImageSprite) {
      this.photoImageSprite.visible = false;
    }
    
    // --- Pin Handling (Standard) ---
    {
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          if (this.document.isOwner) {
            await this.document.update({ [`flags.${MODULE_ID}.pinColor`]: pinColor });
          }
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          this.pinSprite.texture = PIXI.Texture.from(pinImage);
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          this.pinSprite.texture = PIXI.Texture.EMPTY;
        }
        this.pinSprite.width = 40;
        this.pinSprite.height = 40;
        this.pinSprite.position.set(width / 2 - 20, 3);
      }
    }
    
    // Default text layout for non-futuristic notes.
    const font = game.settings.get(MODULE_ID, "font");
    const baseFontSize = game.settings.get(MODULE_ID, "baseFontSize");
    const fontSize = (width / 200) * baseFontSize;
    const textStyle = new PIXI.TextStyle({
      fontFamily: font,
      fontSize: fontSize,
      fill: "#000000",
      wordWrap: true,
      wordWrapWidth: width - 15,
      align: "center",
    });
    const truncatedText = this._truncateText(noteData.text || "Default Text", font, noteData.type, fontSize);
    if (!this.noteText) {
      this.noteText = new PIXI.Text(truncatedText, textStyle);
      this.noteText.anchor.set(0.5);
      this.addChild(this.noteText);
    } else {
      this.noteText.style = textStyle;
      this.noteText.text = truncatedText;
    }
    this.noteText.position.set(width / 2, isPhoto ? height - 25 : height / 2);
  }

  _truncateText(text, font, noteType, currentFontSize) {
    const limits = getDynamicCharacterLimits(font, currentFontSize);
    const charLimit = limits[noteType] || 100;
    return text.length <= charLimit ? text : text.slice(0, charLimit).trim() + "...";
  }
}

async function createNote(noteType) {
  const scene = canvas.scene;
  if (!scene) {
    console.error("Cannot create note: No active scene.");
    return;
  }

  // Retrieve width settings (or use defaults)
  const stickyW = game.settings.get(MODULE_ID, "stickyNoteWidth") || 200;
  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const indexW = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;

  const width = noteType === "photo" ? photoW 
                : noteType === "index" ? indexW 
                : stickyW;
  const height = noteType === "photo" ? Math.round(photoW / (225 / 290)) 
                 : noteType === "index" ? Math.round(indexW / (600 / 400)) 
                 : stickyW;

  const dims = canvas.dimensions;
  const x = dims.width / 2;
  const y = dims.height / 2;

  // Get default text from settings (fallback if missing)
  const defaultText = game.settings.get(MODULE_ID, `${noteType}NoteDefaultText`) || "Notes";

  // Determine board mode and include identityName if note is a futuristic photo note
  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = {};
  if (noteType === "photo" && boardMode === "futuristic") {
    extraFlags.identityName = "";
  }

  await canvas.scene.createEmbeddedDocuments("Drawing", [
    {
      type: "r",
      author: game.user.id,
      x,
      y,
      shape: { width, height },
      fillColor: "#ffffff",
      fillAlpha: 1,
      strokeColor: "transparent",
      strokeAlpha: 0,
      locked: false,
      flags: {
        [MODULE_ID]: {
          type: noteType,
          text: defaultText,
          ...extraFlags
        },
      },
      "flags.core.sheetClass": "investigation-board.CustomDrawingSheet",
      "ownership": { default: 3 },
    },
  ]);

  canvas.drawings.activate();
}

Hooks.on("getSceneControlButtons", (controls) => {
  const journalControls = controls.find((c) => c.name === "notes");
  if (!journalControls) return;

  journalControls.tools.push(
    { name: "createStickyNote", title: "Create Sticky Note", icon: "fas fa-sticky-note", onClick: () => createNote("sticky"), button: true },
    { name: "createPhotoNote", title: "Create Photo Note", icon: "fa-solid fa-camera-polaroid", onClick: () => createNote("photo"), button: true },
    { name: "createIndexCard", title: "Create Index Card", icon: "fa-regular fa-subtitles", onClick: () => createNote("index"), button: true },
    { name: "viewNotePositions", title: "View Note Positions", icon: "fas fa-map-marker-alt", onClick: () => showPositionsDialog(), button: true }
  );
});

Hooks.once("init", () => {
  registerSettings();
  CONFIG.Drawing.objectClass = CustomDrawing;

  DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
    label: "Note Drawing Sheet",
    types: ["base"],
    makeDefault: false,
  });

  console.log("Investigation Board module initialized.");
});

// Initialize position tracking system when Foundry is ready
Hooks.once("ready", () => {
  // Initialize the position manager
  game.InvestigationBoard = game.InvestigationBoard || {};
  game.InvestigationBoard.positions = new NotePositionManager();
  positionManager = game.InvestigationBoard.positions;
  
  console.log(`${MODULE_ID} | Position tracking system initialized`);
});

export { CustomDrawing, CustomDrawingSheet };