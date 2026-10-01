<div align="center">
    <img src="build/icon.png"
        title="AttaCut" alt="AttaCut logo" width="120" />
    <h1>AttaCut</h1>
    <p>
        Cut your clips, move on.
        <br>
        Trimming videos <i>can</i> be quick, easy and lossless.
    </p>
    <a href="https://github.com/noomstuff/attacut/releases">
        Download
    </a>
</div>

---

AttaCut is a fast video trimmer for getting clips out of a recording with as little effort as possible.

Made because quickly cutting or trimming a recording takes way more effort than it should. I wanted to just be able to open a recording, decide what parts to keep, and export while losing minimal quality.

Using the snapping tool you can cut at keyframes only to avoid re-encoding, which makes your exports truly lossless if you really want that.

> The name is based on genera Atta, commonly known as leafcutter ants. Famous for their ability to cut leaves into pieces with remarkable precision.

## Downloads

If you just want to use the app you can grab the latest version from the [releases page](https://github.com/noomstuff/attacut/releases).

Portable and installer versions are available.

## Save an edit

Use Save project in the File menu or Ctrl+S to save an `.attacut` file. On macOS, use Cmd+S. Save project as saves a separate copy. Systems that limit file extensions to three characters can use `.atc` instead.

Open a project file or drop it onto AttaCut to reopen its video, clips, colors, and undo history. The project references the original video, so keep that video too.

Projects store relative and absolute video paths. AttaCut tries the relative path first, then the saved absolute path, and updates changed references after loading. If neither path finds the original, you can locate it.

---

## For developers

You can get started with the [CONTRIBUTING.md](CONTRIBUTING.md) guide to set up a development environment and build AttaCut from source.

PRs welcome. [MIT licensed](LICENSE), do what you want with it.
