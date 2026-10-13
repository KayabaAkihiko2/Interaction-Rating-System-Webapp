// A small React app that loads irs.csv and displays it alongside a video player.

const { useEffect, useMemo, useState, useCallback } = React;

const CSV_FILES = {
  ENG: "IRS_full_ENG.csv",
  JPN: "IRS_full_JPN.csv",
};

const SCORING_RULE_FILES = {
  ENG: "IRS_scoring_rules.md",
  JPN: "IRS_scoring_rules_JPN.md",
};

const SAVED_RATINGS_STORAGE_KEY = "irs-video-rater.saved-ratings.v1";

function parseCsv(text) {
  // A lightweight CSV parser that supports quoted fields and embedded newlines.
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      cur.push(field);
      field = "";
      continue;
    }

    if (ch === "\r") {
      // support CRLF
      if (text[i + 1] === "\n") i += 1;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }

    if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }

    field += ch;
  }

  // final record (if file doesn't end with a newline)
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows;
}

function getItemCode(category, question) {
  const categoryNumber = category?.match(/^\s*(\d{1,2})\./)?.[1];
  const questionNumber = Number(question);
  if (!categoryNumber || !Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 9) {
    return "";
  }
  return `${Number(categoryNumber)}.${questionNumber}`;
}

function parseUploadedRatings(fileName, text, expectedRows) {
  if (!/\.csv$/i.test(fileName)) {
    throw new Error("File must use the .csv extension.");
  }
  const stem = fileName.replace(/\.csv$/i, "");
  const separator = stem.indexOf("_");
  if (separator <= 0 || separator === stem.length - 1) {
    throw new Error("Filename must follow [ID]_[rater name].csv.");
  }

  const id = stem.slice(0, separator).trim();
  const rater = stem.slice(separator + 1).trim();
  if (!id || !rater) throw new Error("Filename must include both an ID and rater name.");

  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV must contain a header and rating rows.");
  const normalizeHeader = (value) => value.replace(/^\uFEFF/, "").trim().toLowerCase();
  const headers = rows[0].map(normalizeHeader);
  const categoryIndex = headers.indexOf("category");
  const questionIndex = headers.indexOf("#");
  const ratingIndex = headers.indexOf("rating");
  if (categoryIndex < 0 || questionIndex < 0 || ratingIndex < 0) {
    throw new Error('CSV must include the "Category", "#", and "Rating" columns.');
  }

  const expectedCodes = new Set(
    expectedRows.map((row) => getItemCode(row[0], row[1]))
  );
  const itemRatings = {};
  const errors = [];

  rows.slice(1).forEach((row, index) => {
    if (row.every((cell) => !cell.trim())) return;
    const itemCode = getItemCode(row[categoryIndex] ?? "", row[questionIndex] ?? "");
    const rating = (row[ratingIndex] ?? "").trim().toLowerCase();
    if (!itemCode || !expectedCodes.has(itemCode)) {
      errors.push(`Row ${index + 2} is not a recognized IRS item.`);
    } else if (Object.prototype.hasOwnProperty.call(itemRatings, itemCode)) {
      errors.push(`Item ${itemCode} appears more than once.`);
    } else if (rating !== "yes" && rating !== "no") {
      errors.push(`Item ${itemCode} is missing a Yes/No rating.`);
    } else {
      itemRatings[itemCode] = rating;
    }
  });

  const missingItems = [...expectedCodes].filter((itemCode) => !itemRatings[itemCode]);
  if (missingItems.length) {
    errors.push(`${missingItems.length} item${missingItems.length === 1 ? "" : "s"} are missing a valid rating.`);
  }
  if (errors.length) throw new Error(errors.slice(0, 3).join(" "));

  return {
    id,
    rater,
    fileName,
    itemRatings,
    itemCount: expectedCodes.size,
    uploadedAt: new Date().toISOString(),
  };
}

function calculateDimensionReliability(raters, itemCodes) {
  const raterCount = raters.length;
  if (itemCodes.length === 0) {
    return { itemCount: 0, percentAgreement: null, fleissKappa: null };
  }
  if (raterCount < 2) {
    return {
      itemCount: itemCodes.length,
      percentAgreement: null,
      fleissKappa: null,
    };
  }

  let observedAgreementTotal = 0;
  let yesRatings = 0;
  let noRatings = 0;

  itemCodes.forEach((itemCode) => {
    const yesCount = raters.filter((rater) => rater.itemRatings[itemCode] === "yes").length;
    const noCount = raterCount - yesCount;
    yesRatings += yesCount;
    noRatings += noCount;
    observedAgreementTotal +=
      (yesCount * (yesCount - 1) + noCount * (noCount - 1)) /
      (raterCount * (raterCount - 1));
  });

  const itemCount = itemCodes.length;
  const percentAgreement = (observedAgreementTotal / itemCount) * 100;
  const totalRatings = itemCount * raterCount;
  const yesProportion = yesRatings / totalRatings;
  const noProportion = noRatings / totalRatings;
  const expectedAgreement = yesProportion ** 2 + noProportion ** 2;
  const fleissKappa =
    expectedAgreement === 1
      ? null
      : (observedAgreementTotal / itemCount - expectedAgreement) /
        (1 - expectedAgreement);

  return { itemCount, percentAgreement, fleissKappa };
}

function parseScoringRules(markdown) {
  const rulesByItem = {};
  const addRule = (itemCode, rule) => {
    if (!rulesByItem[itemCode]) rulesByItem[itemCode] = [];
    if (!rulesByItem[itemCode].includes(rule)) rulesByItem[itemCode].push(rule);
  };

  markdown.split(/\r?\n/).forEach((line) => {
    if (!line.trim().startsWith("|")) return;

    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());

    if (cells.length !== 3 || cells[0] === "Item" || cells[0] === "---") return;

    if (/^\d{1,2}\.\d$/.test(cells[0])) {
      addRule(cells[0], `${cells[1]} → ${cells[2]}`);
      return;
    }

    const itemCodes = new Set(
      `${cells[0]} ${cells[1]}`.match(/\b\d{1,2}\.\d\b/g) ?? []
    );
    itemCodes.forEach((itemCode) => {
      addRule(itemCode, `Cross-item rule: ${cells[0]} → ${cells[1]} (${cells[2]})`);
    });
  });

  return rulesByItem;
}

function downloadCsv(rows, filename) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell == null) return "";
          const str = String(cell);
          if (/[,\n\r\"]/.test(str)) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        })
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Define which questions should be auto-marked when 5.3 is set to "no"
// The rule values are zero-based data row indices.
const AUTO_MARK_RULES = {
  // Zero-based data row indices for questions 7.2, 7.4, 7.5, 7.6, and 8.5.
  "5.3": [35, 37, 38, 39, 47]
};

function getAutoMarkedRows(triggerCategory, triggerQuestion, answer) {
  if (triggerCategory === "5. Emotional self-regulation" && triggerQuestion === 3 && answer === "no") {
    return AUTO_MARK_RULES["5.3"] || [];
  }
  return [];
}

function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoId, setVideoId] = useState("");
  const [language, setLanguage] = useState("ENG");
  const [csvRowsByLanguage, setCsvRowsByLanguage] = useState({});
  const [csvErrors, setCsvErrors] = useState({});
  const [scoringRulesByLanguage, setScoringRulesByLanguage] = useState({});
  const [scoringRulesErrors, setScoringRulesErrors] = useState({});
  const [sharedTipsByLanguage, setSharedTipsByLanguage] = useState({});
  const [sharedTipsError, setSharedTipsError] = useState("");
  const [tipEditor, setTipEditor] = useState(null);
  const [tipEditorError, setTipEditorError] = useState("");
  const [tipEditorBusy, setTipEditorBusy] = useState(false);
  const [activeScoringHint, setActiveScoringHint] = useState(null);
  const [ratings, setRatings] = useState({});
  const [autoMarkedRows, setAutoMarkedRows] = useState(new Set()); // Track which rows are auto-marked
  const [savedRatings, setSavedRatings] = useState([]);
  const [currentSavedId, setCurrentSavedId] = useState(null);
  const [activeTab, setActiveTab] = useState("rating");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [reliabilityFiles, setReliabilityFiles] = useState([]);
  const [reliabilityUploadErrors, setReliabilityUploadErrors] = useState([]);
  const [reliabilityUploadMessage, setReliabilityUploadMessage] = useState("");
  const [reliabilityServerError, setReliabilityServerError] = useState("");
  const [reliabilityUploading, setReliabilityUploading] = useState(false);

  const used_csv = CSV_FILES[language];

  const loadSharedTips = useCallback(async () => {
    try {
      const response = await fetch("api/tips.php");
      if (!response.ok) throw new Error(`Failed to load shared tips: ${response.status}`);
      const payload = await response.json();
      if (!payload.tips || typeof payload.tips !== "object") {
        throw new Error("The shared tips response has an invalid format.");
      }
      setSharedTipsByLanguage(payload.tips);
      setSharedTipsError("");
    } catch (err) {
      console.error(err);
      setSharedTipsError(
        "Shared tips are unavailable. Check that PHP is enabled and api/tips.php is deployed."
      );
    }
  }, []);

  const loadSharedRatings = useCallback(async () => {
    try {
      const response = await fetch("api/ratings.php");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Failed to load shared ratings: ${response.status}`);
      }
      if (!Array.isArray(payload.ratings)) {
        throw new Error("The shared ratings response has an invalid format.");
      }
      setReliabilityFiles(payload.ratings);
      setReliabilityServerError("");
    } catch (err) {
      console.error(err);
      setReliabilityServerError(
        "Shared ratings are unavailable. Check that PHP is enabled, api/ratings.php is deployed, and the instance folder is writable."
      );
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_RATINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) throw new Error("Saved ratings data is not a list.");
        setSavedRatings(parsed);
      }
    } catch (err) {
      console.error("Could not read saved ratings from browser storage.", err);
      setSaveError("Saved ratings could not be read from this browser.");
    }
  }, []);

  useEffect(() => {
    loadSharedTips();
    const intervalId = window.setInterval(loadSharedTips, 15000);
    window.addEventListener("focus", loadSharedTips);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadSharedTips);
    };
  }, [loadSharedTips]);

  useEffect(() => {
    loadSharedRatings();
    const intervalId = window.setInterval(loadSharedRatings, 15000);
    window.addEventListener("focus", loadSharedRatings);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadSharedRatings);
    };
  }, [loadSharedRatings]);

  useEffect(() => {
    let cancelled = false;

    Object.entries(SCORING_RULE_FILES).forEach(([languageCode, filename]) => {
      fetch(filename)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
          return res.text();
        })
        .then((text) => {
          if (cancelled) return;
          setScoringRulesByLanguage((previous) => ({
            ...previous,
            [languageCode]: parseScoringRules(text),
          }));
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          setScoringRulesErrors((previous) => ({
            ...previous,
            [languageCode]: `Scoring hints could not be loaded from ${filename}.`,
          }));
        });
    });

    Object.entries(CSV_FILES).forEach(([languageCode, filename]) => {
      fetch(filename)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
          return res.text();
        })
        .then((text) => {
          if (cancelled) return;
          setCsvRowsByLanguage((previous) => ({
            ...previous,
            [languageCode]: parseCsv(text),
          }));
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          setCsvErrors((previous) => ({
            ...previous,
            [languageCode]: `Could not load ${filename}.`,
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    const name = videoFile.name.replace(/\.[^/.]+$/, "");
    setVideoId(name);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  const csvRows = csvRowsByLanguage[language] ?? [];
  const englishCsvRows = csvRowsByLanguage.ENG ?? [];
  const scoringRules = scoringRulesByLanguage[language] ?? {};
  const scoringRulesError = scoringRulesErrors[language] ?? "";
  const headers = useMemo(() => (csvRows.length ? csvRows[0] : []), [csvRows]);
  const dataRows = useMemo(() => (csvRows.length > 1 ? csvRows.slice(1) : []), [csvRows]);
  const englishHeaders = englishCsvRows[0] ?? [];
  const englishDataRows = englishCsvRows.slice(1);
  const sharedTips = sharedTipsByLanguage[language] ?? {};
  const answeredCount = dataRows.reduce(
    (count, _row, index) =>
      ratings[index]?.rating === "yes" || ratings[index]?.rating === "no"
        ? count + 1
        : count,
    0
  );
  const allItemsAnswered =
    dataRows.length > 0 &&
    englishDataRows.length === dataRows.length &&
    answeredCount === dataRows.length;
  const reliabilityGroups = useMemo(() => {
    const groups = new Map();
    reliabilityFiles.forEach((ratingFile) => {
      if (!groups.has(ratingFile.id)) groups.set(ratingFile.id, []);
      groups.get(ratingFile.id).push(ratingFile);
    });

    return [...groups.entries()].map(([id, raters]) => {
      const dimensions = new Map();
      englishDataRows.forEach((row) => {
        const itemCode = getItemCode(row[0], row[1]);
        const categoryNumber = Number(row[0]?.match(/^\s*(\d{1,2})\./)?.[1]);
        if (!dimensions.has(categoryNumber)) {
          dimensions.set(categoryNumber, {
            name: row[0],
            itemCodes: [],
          });
        }
        dimensions.get(categoryNumber).itemCodes.push(itemCode);
      });

      return {
        id,
        raters,
        dimensions: [...dimensions.entries()].map(([categoryNumber, dimension]) => ({
          categoryNumber,
          name: dimension.name,
          ...calculateDimensionReliability(raters, dimension.itemCodes),
        })),
      };
    });
  }, [englishDataRows, reliabilityFiles]);

  const showScoringHint = (event, itemCode, text) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const popupWidth = Math.min(448, window.innerWidth - 32);
    setActiveScoringHint({
      itemCode,
      text,
      left: Math.min(Math.max(16, bounds.left), window.innerWidth - popupWidth - 16),
      top: Math.min(bounds.bottom + 8, window.innerHeight * 0.5),
    });
  };

  const onRatingChange = useCallback(
    (rowIndex, value) => {
      setSaveError("");
      setSaveMessage("");
      const row = englishDataRows[rowIndex];
      const isTriggerQuestion =
        row?.[0] === "5. Emotional self-regulation" && row?.[1] === "3";
      const shouldAutoMark =
        isTriggerQuestion &&
        value.rating === "no" &&
        ratings[rowIndex]?.rating !== "no" &&
        window.confirm(
          'Did you answer "No" because the caregiver never attempts to soothe the child?'
        );
      const affected = getAutoMarkedRows("5. Emotional self-regulation", 3, "no");

      if (isTriggerQuestion && value.rating === "no" && shouldAutoMark) {
        setAutoMarkedRows(new Set(affected));
      } else if (isTriggerQuestion && value.rating === "yes") {
        setAutoMarkedRows(new Set());
      }

      setRatings((prev) => {
        const updated = { ...prev, [rowIndex]: value };

        if (isTriggerQuestion && value.rating === "no" && shouldAutoMark) {
          affected.forEach((affectedIdx) => {
            updated[affectedIdx] = {
              ...updated[affectedIdx],
              rating: "no",
              note: "auto marked due to 5.3",
              isAutoMarked: true
            };
          });
        } else if (isTriggerQuestion && value.rating === "yes") {
          affected.forEach((affectedIdx) => {
            if (updated[affectedIdx]?.isAutoMarked) {
              delete updated[affectedIdx];
            }
          });
        }

        return updated;
      });
    },
    [englishDataRows, ratings]
  );

  const importReliabilityFile = async (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;
    if (!englishDataRows.length) {
      setReliabilityUploadErrors(["The IRS item list is not loaded yet."]);
      return;
    }

    setReliabilityUploading(true);
    setReliabilityUploadErrors([]);
    setReliabilityUploadMessage("");
    try {
      const csv = await selectedFile.text();
      parseUploadedRatings(selectedFile.name, csv, englishDataRows);
      const response = await fetch("api/ratings.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedFile.name, csv }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Upload failed: ${response.status}`);
      }
      await loadSharedRatings();
      setReliabilityUploadMessage(
        `${selectedFile.name} was saved to the shared server. Re-uploading the same ID and rater replaces the previous submission.`
      );
    } catch (error) {
      console.error(error);
      setReliabilityUploadErrors([`${selectedFile.name}: ${error.message}`]);
    } finally {
      setReliabilityUploading(false);
    }
  };

  const exportRatings = () => {
    if (!allItemsAnswered) {
      setSaveMessage("");
      setSaveError("Complete every rating item before exporting the CSV.");
      return;
    }

    const outRows = [
      [...englishHeaders, "Rating", "Notes"],
      ...englishDataRows.map((row, idx) => {
        const rating = ratings[idx]?.rating ?? "";
        const note = ratings[idx]?.note ?? "";
        return [...row, rating, note];
      }),
    ];
    downloadCsv(outRows, `${videoId || "ratings"}.csv`);
  };

  const openTipEditor = (itemCode) => {
    setActiveScoringHint(null);
    setTipEditorError("");
    setTipEditor({
      language,
      itemCode,
      text: sharedTips[itemCode] ?? "",
    });
  };

  const saveSharedTip = async () => {
    if (!tipEditor) return;
    setTipEditorBusy(true);
    setTipEditorError("");

    try {
      const response = await fetch("api/tips.php", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: tipEditor.language,
          itemCode: tipEditor.itemCode,
          text: tipEditor.text,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Failed to save shared tip: ${response.status}`);
      }

      const text = tipEditor.text.trim();
      setSharedTipsByLanguage((previous) => {
        const languageTips = { ...(previous[tipEditor.language] ?? {}) };
        if (text) {
          languageTips[tipEditor.itemCode] = text;
        } else {
          delete languageTips[tipEditor.itemCode];
        }
        return { ...previous, [tipEditor.language]: languageTips };
      });
      setTipEditor(null);
      setSharedTipsError("");
    } catch (err) {
      console.error(err);
      setTipEditorError(err.message || "Could not save the shared tip.");
    } finally {
      setTipEditorBusy(false);
    }
  };

  const saveCurrentRatings = () => {
    if (!dataRows.length || englishDataRows.length !== dataRows.length) {
      setSaveMessage("");
      setSaveError("The rating sheet is not ready to save yet.");
      return;
    }

    const savedId =
      currentSavedId ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const savedAt = new Date().toISOString();
    const savedRecord = {
      id: savedId,
      videoId: videoId.trim(),
      language,
      ratings,
      autoMarkedRows: [...autoMarkedRows],
      answeredCount,
      totalItems: dataRows.length,
      completed: allItemsAnswered,
      savedAt,
    };
    const nextSavedRatings = currentSavedId
      ? savedRatings.map((saved) => (saved.id === currentSavedId ? savedRecord : saved))
      : [savedRecord, ...savedRatings];

    try {
      localStorage.setItem(SAVED_RATINGS_STORAGE_KEY, JSON.stringify(nextSavedRatings));
      setSavedRatings(nextSavedRatings);
      setCurrentSavedId(savedId);
      setSaveError("");
      setSaveMessage(
        allItemsAnswered
          ? "Completed ratings saved in this browser."
          : `Progress saved in this browser (${answeredCount} of ${dataRows.length} answered).`
      );
    } catch (err) {
      console.error("Could not save ratings to browser storage.", err);
      setSaveMessage("");
      setSaveError("Ratings could not be saved in this browser. Check available storage.");
    }
  };

  const openSavedRatings = (savedRecord) => {
    setVideoId(savedRecord.videoId ?? "");
    setLanguage(savedRecord.language === "JPN" ? "JPN" : "ENG");
    setRatings(savedRecord.ratings ?? {});
    setAutoMarkedRows(new Set(savedRecord.autoMarkedRows ?? []));
    setCurrentSavedId(savedRecord.id);
    setSaveError("");
    setSaveMessage("");
    setActiveTab("rating");
  };

  const startNewRating = () => {
    if (
      Object.keys(ratings).length > 0 &&
      !window.confirm("Clear the current ratings and start a new rating?")
    ) {
      return;
    }

    setRatings({});
    setAutoMarkedRows(new Set());
    setVideoFile(null);
    setVideoUrl("");
    setVideoId("");
    setCurrentSavedId(null);
    setSaveError("");
    setSaveMessage("");
    setActiveTab("rating");
  };

  return (
    <>
      <header style={{ padding: "1rem"}}> 
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h1 style={{ margin: 0 }}>IRS Video Rater</h1>
            <img src="styles/hosodalab_logo_purple.png" style={{ width: "80px", borderRadius: 8 }}/>
        </div>
        <p className="small">
          Select a local <strong>.mp4</strong> file, then use the controls to watch the
          video while rating the items from <code>{used_csv}</code>.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="small">
            Rating language: {language === "ENG" ? "English" : "Japanese"}
          </span>
          <button
            type="button"
            onClick={() => {
              setActiveScoringHint(null);
              setLanguage((current) => (current === "ENG" ? "JPN" : "ENG"));
            }}
            aria-label={`Switch rating language to ${language === "ENG" ? "Japanese" : "English"}`}
          >
            {language === "ENG" ? "日本語に切り替え (Switch to Japanese)" : "Switch to English (英語に切り替え)"}
          </button>
        </div>
      </header>

      <main>
        <section className="panel">
          <h2>Video Player</h2>
          <label>
            Video file
            <br></br>
            <input
                style={{marginTop: "0.5rem" }}
                type="file"
                accept="video/mp4"
                onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label>
            Participant ID (used for exporting ratings)
            <input
              style={{marginTop: "0.5rem" }}
              type="text"
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
              placeholder="Enter ID or load a video to auto-populate"
            />
          </label>

          {videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              style={{ width: "100%", marginTop: "1rem", borderRadius: 8 }}
            />
          ) : (
            <p className="small">Load an MP4 file to start.</p>
          )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            type="button"
            onClick={saveCurrentRatings}
            disabled={!dataRows.length || englishDataRows.length !== dataRows.length}
          >
            Save progress
          </button>
          <button
            type="button"
            onClick={exportRatings}
            disabled={!allItemsAnswered}
          >
            Export ratings as CSV
          </button>
          <button type="button" onClick={startNewRating}>
            New rating
          </button>
        </div>
        <p className="small" role="status">
          {dataRows.length
            ? `${answeredCount} of ${dataRows.length} items answered. CSV export is available when all items are answered.`
            : "Loading rating items…"}
        </p>
        <p className="small" role={saveError ? "alert" : "status"}>
          {saveError || saveMessage}
        </p>
        </section>

        <section className="panel">
          <div role="tablist" aria-label="Rating views" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "rating"}
              onClick={() => setActiveTab("rating")}
            >
              Rating Sheet
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "saved"}
              onClick={() => {
                setActiveScoringHint(null);
                setActiveTab("saved");
              }}
            >
              Saved Ratings ({savedRatings.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "reliability"}
              onClick={() => {
                setActiveScoringHint(null);
                setActiveTab("reliability");
              }}
            >
              Inter-rater Reliability
            </button>
          </div>
          {activeTab === "rating" ? (
            <>
          <h2>Rating Sheet</h2>
          <div className="small">
            The table below comes from <code>{used_csv}</code>. Use the “Rating” and “Notes”
            columns to record your observations while watching the video.
          </div>
          {csvErrors[language] ? (
            <p role="alert">{csvErrors[language]}</p>
          ) : !dataRows.length ? (
            <p className="small">Loading rating sheet…</p>
          ) : null}
          {scoringRulesError && <p role="alert">{scoringRulesError}</p>}

          <div style={{ overflowY: "scroll", height: "800px", overflowX: "auto", marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>Rating</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, idx) => {
                  const isAutoMarked = autoMarkedRows.has(idx);
                  const rowOpacity = isAutoMarked ? 0.6 : 1;
                  const rowStyle = isAutoMarked ? { opacity: rowOpacity, backgroundColor: "#f5f5f5" } : {};
                  const englishRow = englishDataRows[idx] ?? [];
                  const categoryNumber = englishRow[0]?.match(/^\d+/)?.[0];
                  const itemCode = `${categoryNumber}.${englishRow[1]}`;
                  const itemRules = scoringRules[itemCode] ?? [];
                  const sharedTip = sharedTips[itemCode] ?? "";
                  const itemHint = [itemRules.join("\n"), sharedTip]
                    .filter(Boolean)
                    .join("\n\n");
                  const itemHasTip = Boolean(itemHint.trim());
                  
                  return (
                    <tr key={idx} style={rowStyle}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${idx}-${cellIndex}`}>
                          {cell}
                          {cellIndex === 2 && (
                            <button
                              type="button"
                              className={`info-button${itemHasTip ? "" : " info-button--empty"}`}
                              aria-label={
                                itemHasTip
                                  ? `View or edit tip for item ${itemCode}`
                                  : `Add a shared tip for item ${itemCode}`
                              }
                              aria-describedby={
                                itemHasTip && activeScoringHint?.itemCode === itemCode
                                  ? "scoring-hint-popup"
                                  : undefined
                              }
                              onClick={() => openTipEditor(itemCode)}
                              onMouseEnter={
                                itemHasTip
                                  ? (event) => showScoringHint(event, itemCode, itemHint)
                                  : undefined
                              }
                              onMouseLeave={itemHasTip ? () => setActiveScoringHint(null) : undefined}
                              onFocus={
                                itemHasTip
                                  ? (event) => showScoringHint(event, itemCode, itemHint)
                                  : undefined
                              }
                              onBlur={itemHasTip ? () => setActiveScoringHint(null) : undefined}
                              style={{ marginLeft: "0.5rem" }}
                            >
                              i
                            </button>
                          )}
                        </td>
                      ))}
                      <td>
                        <select
                          disabled={isAutoMarked}
                          value={ratings[idx]?.rating ?? ""}
                          onChange={(e) =>
                            onRatingChange(idx, {
                              ...ratings[idx],
                              rating: e.target.value,
                            })
                          }
                          style={{
                            opacity: isAutoMarked ? 0.6 : 1,
                            cursor: isAutoMarked ? "not-allowed" : "pointer"
                          }}
                        >
                          <option value="" disabled>
                            —
                          </option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </td>
                      <td>
                        <textarea
                          disabled={isAutoMarked}
                          rows={1}
                          value={ratings[idx]?.note ?? ""}
                          onChange={(e) =>
                            onRatingChange(idx, {
                              ...ratings[idx],
                              note: e.target.value,
                            })
                          }
                          placeholder={isAutoMarked ? "Auto marked due to 5.3" : "Optional note"}
                          style={{ 
                            width: "100%",
                            opacity: isAutoMarked ? 0.6 : 1,
                            cursor: isAutoMarked ? "not-allowed" : "auto"
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeScoringHint && (
            <div
              id="scoring-hint-popup"
              className="scoring-hint-popup"
              role="tooltip"
              style={{
                left: `${activeScoringHint.left}px`,
                top: `${activeScoringHint.top}px`,
              }}
            >
              {activeScoringHint.text}
            </div>
          )}
          {tipEditor && (
            <div className="tip-editor-backdrop">
              <section
                className="tip-editor"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tip-editor-title"
              >
                <h2 id="tip-editor-title">
                  {tipEditor.language === "JPN"
                    ? `項目 ${tipEditor.itemCode} の共有ヒント`
                    : `Shared tip for item ${tipEditor.itemCode}`}
                </h2>
                <p className="small">
                  {tipEditor.language === "JPN"
                    ? "このヒントはラボ内の全ユーザーに共有されます。"
                    : "This tip is shared with all users of the lab server."}
                </p>
                <label htmlFor="shared-tip-text">
                  {tipEditor.language === "JPN" ? "ヒント" : "Tip"}
                </label>
                <textarea
                  id="shared-tip-text"
                  rows={6}
                  maxLength={5000}
                  value={tipEditor.text}
                  onChange={(event) =>
                    setTipEditor((current) => ({ ...current, text: event.target.value }))
                  }
                  placeholder={
                    tipEditor.language === "JPN"
                      ? "この項目の採点例やヒントを入力してください"
                      : "Add an example or guidance for rating this item"
                  }
                  autoFocus
                />
                <p className="small">{tipEditor.text.length} / 5000</p>
                {tipEditorError && <p role="alert">{tipEditorError}</p>}
                {sharedTipsError && <p role="alert">{sharedTipsError}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  <button type="button" onClick={saveSharedTip} disabled={tipEditorBusy}>
                    {tipEditor.language === "JPN" ? "共有ヒントを保存" : "Save shared tip"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipEditor(null)}
                    disabled={tipEditorBusy}
                  >
                    {tipEditor.language === "JPN" ? "キャンセル" : "Cancel"}
                  </button>
                </div>
              </section>
            </div>
          )}
            </>
          ) : activeTab === "saved" ? (
            <div role="tabpanel">
              <h2>Saved Ratings</h2>
              <p className="small">
                Saved ratings are kept in this browser. Video files are not stored; select the video again when resuming.
              </p>
              {!savedRatings.length ? (
                <p className="small">No saved ratings in this browser yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {savedRatings.map((savedRecord) => (
                    <li
                      key={savedRecord.id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        padding: "0.75rem 0",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      <div>
                        <strong>{savedRecord.videoId || "Untitled ratings"}</strong>
                        <div className="small">
                          {savedRecord.completed ? "Completed" : "In progress"} ·{" "}
                          {savedRecord.answeredCount} of {savedRecord.totalItems} items answered
                          {" · "}
                          {new Date(savedRecord.savedAt).toLocaleString()}
                        </div>
                      </div>
                      <button type="button" onClick={() => openSavedRatings(savedRecord)}>
                        Resume
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={startNewRating} style={{ marginTop: "1rem" }}>
                Start a new rating
              </button>
            </div>
          ) : (
            <div role="tabpanel">
              <h2>Inter-rater Reliability</h2>
              <p>
                Upload completed rating CSVs named <code>[ID]_[rater name].csv</code>.
                The ID is the filename text before the first underscore; files with the
                same ID are compared as ratings of the same video.
              </p>
              <p className="small">
                Fleiss’ kappa and raw percent agreement are calculated for each IRS
                dimension, using its items as observations and each uploaded CSV as a
                rater. Each CSV is uploaded to shared server storage and is matched with
                submissions that have the same video ID. Re-uploading the same ID and
                rater replaces that rater’s earlier submission.
              </p>
              <p className="small">
                Shared submissions can be viewed and replaced by anyone who can access
                this page. Do not upload identifying or confidential information.
              </p>
              <label>
                Upload your completed rating CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={importReliabilityFile}
                  disabled={reliabilityUploading}
                  style={{ display: "block", marginTop: "0.5rem" }}
                />
              </label>
              {reliabilityUploading && <p role="status">Uploading rating to shared server…</p>}
              {reliabilityUploadMessage && <p role="status">{reliabilityUploadMessage}</p>}
              {reliabilityUploadErrors.length > 0 && (
                <div role="alert">
                  <strong>Rating could not be uploaded:</strong>
                  <ul>
                    {reliabilityUploadErrors.map((error, index) => (
                      <li key={`${index}-${error}`}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {reliabilityServerError && <p role="alert">{reliabilityServerError}</p>}
              {reliabilityFiles.length === 0 ? (
                !reliabilityServerError && (
                  <p className="small">No ratings have been uploaded to the shared server yet.</p>
                )
              ) : (
                <>
                  <h3>Shared ratings ({reliabilityFiles.length})</h3>
                  <ul>
                    {reliabilityFiles.map((ratingFile) => (
                      <li key={`${ratingFile.id}-${ratingFile.rater}`}>
                        <code>{ratingFile.fileName}</code>
                        {" — "}
                        {ratingFile.itemCount} items ·{" "}
                        {new Date(ratingFile.uploadedAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                  {reliabilityGroups.map((group) => (
                    <section key={group.id} style={{ marginTop: "1.5rem" }}>
                      <h3>Video ID: {group.id}</h3>
                      <p className="small">
                        {group.raters.length} rater{group.raters.length === 1 ? "" : "s"}:{" "}
                        {group.raters.map((rater) => rater.rater).join(", ")}
                      </p>
                      {group.raters.length < 2 && (
                        <p className="small">
                          Upload at least one more rater’s CSV for this video to calculate reliability.
                        </p>
                      )}
                      <div style={{ overflowX: "auto" }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Dimension</th>
                              <th>Items</th>
                              <th>Fleiss’ κ</th>
                              <th>Raw agreement</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.dimensions.map((dimension) => (
                              <tr key={dimension.categoryNumber}>
                                <td>{dimension.name}</td>
                                <td>{dimension.itemCount ?? "—"}</td>
                                <td>
                                  {group.raters.length < 2
                                    ? "Need 2+ raters"
                                    : dimension.fleissKappa == null
                                      ? "N/A (no rating variation)"
                                      : dimension.fleissKappa.toFixed(3)}
                                </td>
                                <td>
                                  {dimension.percentAgreement == null
                                    ? "—"
                                    : `${dimension.percentAgreement.toFixed(1)}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      </main>
      <footer style={{ padding: "1rem", textAlign: "center", fontSize: "0.8rem", color: "#666" }}>
        <p className="small">
          <strong>IRS System Reference:</strong>
          <br></br>
          <i>Anme, T., Shinohara, R., Sugisawa, Y., Tong, L., Tanaka, E., Watanabe, T., Onda, Y., Kawashima, Y., Hirano, M., Tomisaki, E., Mochizuki, Y., Morita, K., Gan-Yadam, A., Yato, Y., & Yamakawa, N. (2010). Interaction Rating Scale (IRS) as an evidence-based practical index of children’s social skills and parenting. Journal of Epidemiology, 20(SUPPL.2), undefined-undefined. https://doi.org/10.2188/jea.JE20090171</i>
        </p>
        &copy; 2026 HosoLab. All rights reserved.
      </footer>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
