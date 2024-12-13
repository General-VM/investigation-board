# Investigation Board

A Foundry VTT module that lets everyone create, edit, and move sticky and photo notes on the scene. A must-have for investigative games like City of Mist, Call of Cthulhu, and all your conspiracy adventures.

![image](https://github.com/user-attachments/assets/aa6ac7ea-6051-4c10-b88f-c4dcc8a3bd62)

## New Feature (v1.2)

![image](https://github.com/user-attachments/assets/c9205949-ff92-4afa-abc0-1380bd152b18)

Create photo notes directly from Actors and Scenes. Click with the right button over an actor or scene you want to create a note and select Create Photo Note from... in the context menu.

**For Scenes:** the note will display the navigation name and the scene name if there isn't one.
**For Actors:** the note will display the Token name (prototypeToken.name) or any other key you point out in the settings (like system.alias for FitD games). If left empty it will default to just the name of the actor.

## How to Use

![image](https://github.com/user-attachments/assets/c922e8d5-b168-4155-a5e3-229c06a54aa0)

Open the Journal Notes Toolbar:

On the left sidebar of the scene, select the Journal Notes tools.
You’ll see two new buttons:
Create Sticky Note (a sticky note icon)
Create Photo Note (a Polaroid camera icon)

### Create and Edit a Note

Click Create Sticky Note/Photo Note to place one of them in the middle of the scene.

The scene will automatically go to __drawing mode__, and you can change the note content with a DOUBLE CLICK.

__Edit and drag__ the note around is only possible in **drawing mode** ![image](https://github.com/user-attachments/assets/4b6ecb10-2ab4-4328-82fb-939bbcca1f91)
, since in the end, they are a drawing. 

#### **Note** (pun intended): Only the GM can assign an image to the photo notes unless she/he/they give you browser file permissions.

If you click on the Delete button of the Drawing tools, ALL NOTES WILL BE DELETED, so beware. To delete notes and drawings individually, select them and use the Delete button on your keyboard.

The module's settings contain some pretty straightforward options, so you can better adjust it for your table. 

![image](https://github.com/user-attachments/assets/47a642e8-ee5f-4d8a-89cf-c670e84276c2)


## Installation

To install this module, in Foundry VTT go to the Add-on Modules tab:

Search in the top bar for "investigation board" and click Install

OR

Click Install Module

Paste the following manifest URL into the bottom Manifest URL field: https://raw.githubusercontent.com/mordachai/investigation-board/main/module.json

After that go to your world and enable the module in your Game Settings under Manage Modules

## Known Limitations

- **Refresh on Update:** The module includes a hook to ensure notes are redrawn when updated by others. However, if something seems out of date, try selecting/deselecting notes or refreshing the page.
