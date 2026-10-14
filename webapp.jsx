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

const SUPPLEMENTAL_RATINGS = [
  { type: "domain_impression", code: "1", label: "Autonomy", labelJpn: "主体性" },
  { type: "domain_impression", code: "2", label: "Responsiveness", labelJpn: "応答性" },
  { type: "domain_impression", code: "3", label: "Empathy", labelJpn: "共感性" },
  { type: "domain_impression", code: "4", label: "Motor self-regulation", labelJpn: "運動制御" },
  { type: "domain_impression", code: "5", label: "Emotional self-regulation", labelJpn: "感情制御" },
  { type: "domain_impression", code: "6", label: "Support for autonomy development", labelJpn: "主体性発達への配慮" },
  { type: "domain_impression", code: "7", label: "Support for responsiveness", labelJpn: "応答性への配慮" },
  { type: "domain_impression", code: "8", label: "Support for empathy", labelJpn: "共感性への配慮" },
  { type: "domain_impression", code: "9", label: "Support for cognitive development", labelJpn: "認知発達への配慮" },
  { type: "domain_impression", code: "10", label: "Support for socioemotional development", labelJpn: "社会情緒発達への配慮" },
  { type: "overall_relationship", code: "overall", label: "Overall relationship", labelJpn: "関係性総合評価" },
];

const FIVE_POINT_SCALE = [
  { value: "1", label: "Not at all applicable", labelJpn: "まったくあてはまらない" },
  { value: "2", label: "Not very applicable", labelJpn: "あまりあてはまらない" },
  { value: "3", label: "Neither applicable nor inapplicable", labelJpn: "どちらともいえない" },
  { value: "4", label: "Somewhat applicable", labelJpn: "ややあてはまる" },
  { value: "5", label: "Very applicable", labelJpn: "よくあてはまる" },
];

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
  const notesIndex = headers.findIndex((header) =>
    ["notes", "comments", "comment"].includes(header)
  );
  if (categoryIndex < 0 || questionIndex < 0 || ratingIndex < 0) {
    throw new Error('CSV must include the "Category", "#", and "Rating" columns.');
  }

  const expectedCodes = new Set(
    expectedRows.map((row) => getItemCode(row[0], row[1]))
  );
  const itemRatings = {};
  const itemNotes = {};
  const supplementalRatings = {};
  const errors = [];
  const supplementalHeaderIndex = rows.findIndex(
    (row) =>
      row[0]?.trim().toLowerCase() === "rating type" &&
      row[1]?.trim().toLowerCase() === "code"
  );
  const itemRows = rows.slice(1, supplementalHeaderIndex < 0 ? rows.length : supplementalHeaderIndex);

  itemRows.forEach((row, index) => {
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
      itemNotes[itemCode] = notesIndex < 0 ? "" : (row[notesIndex] ?? "").trim();
    }
  });

  if (supplementalHeaderIndex >= 0) {
    const supplementalHeaders = rows[supplementalHeaderIndex].map((value) =>
      value.replace(/^\uFEFF/, "").trim().toLowerCase()
    );
    const typeIndex = supplementalHeaders.indexOf("rating type");
    const codeIndex = supplementalHeaders.indexOf("code");
    const dimensionIndex = supplementalHeaders.indexOf("dimension");
    const supplementalRatingIndex = supplementalHeaders.indexOf("rating");
    const supplementalNotesIndex = supplementalHeaders.indexOf("notes");
    if ([typeIndex, codeIndex, dimensionIndex, supplementalRatingIndex].some((index) => index < 0)) {
      errors.push('Supplemental ratings need "Rating type", "Code", "Dimension", and "Rating" columns.');
    } else {
      rows.slice(supplementalHeaderIndex + 1).forEach((row, index) => {
        if (row.every((cell) => !cell.trim())) return;
        const type = (row[typeIndex] ?? "").trim().toLowerCase();
        const code = (row[codeIndex] ?? "").trim();
        const item = SUPPLEMENTAL_RATINGS.find(
          (candidate) => candidate.type === type && candidate.code === code
        );
        if (!item) {
          errors.push(`Supplemental rating row ${supplementalHeaderIndex + index + 2} has an unknown type or code.`);
          return;
        }
        const key = `${item.type}:${item.code}`;
        if (Object.prototype.hasOwnProperty.call(supplementalRatings, key)) {
          errors.push(`Supplemental rating "${item.label}" appears more than once.`);
          return;
        }
        const rating = (row[supplementalRatingIndex] ?? "").trim();
        if (rating && !FIVE_POINT_SCALE.some((scale) => scale.value === rating)) {
          errors.push(`Supplemental rating "${item.label}" must be blank or a value from 1 to 5.`);
          return;
        }
        supplementalRatings[key] = {
          rating,
          note: supplementalNotesIndex < 0 ? "" : (row[supplementalNotesIndex] ?? "").trim(),
        };
      });
    }
  }

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
    itemNotes,
    supplementalRatings,
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
      disagreedItemCount: null,
    };
  }

  let observedAgreementTotal = 0;
  let disagreedItemCount = 0;
  let yesRatings = 0;
  let noRatings = 0;

  itemCodes.forEach((itemCode) => {
    const yesCount = raters.filter((rater) => rater.itemRatings[itemCode] === "yes").length;
    const noCount = raterCount - yesCount;
    if (yesCount > 0 && noCount > 0) disagreedItemCount += 1;
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

  return { itemCount, percentAgreement, fleissKappa, disagreedItemCount };
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
  const [supplementalRatings, setSupplementalRatings] = useState({});
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
  const [expandedReliabilityDimensions, setExpandedReliabilityDimensions] = useState({});

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
  const answeredSupplementalCount = SUPPLEMENTAL_RATINGS.filter((item) =>
    FIVE_POINT_SCALE.some(
      (scale) =>
        scale.value ===
        supplementalRatings[`${item.type}:${item.code}`]?.rating
    )
  ).length;
  const allSupplementalRatingsAnswered =
    answeredSupplementalCount === SUPPLEMENTAL_RATINGS.length;
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
        overall: calculateDimensionReliability(
          raters,
          englishDataRows.map((row) => getItemCode(row[0], row[1]))
        ),
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

  const onSupplementalRatingChange = (key, value) => {
    setSupplementalRatings((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...value },
    }));
    setSaveError("");
    setSaveMessage("");
  };

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
      const responseText = await response.text();
      let payload;
      try {
        payload = JSON.parse(responseText);
      } catch {
        const contentType = response.headers.get("content-type") || "unknown content type";
        throw new Error(
          `The server returned HTML or another non-JSON response (HTTP ${response.status}; ${contentType}). Confirm api/ratings.php is deployed in the site's api folder and PHP is enabled for it.`
        );
      }
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

  const toggleReliabilityDimension = (groupId, categoryNumber) => {
    const key = `${groupId}:${categoryNumber}`;
    setExpandedReliabilityDimensions((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  };

  const exportReliabilityReport = (group) => {
    const rows = [
      [
        "Video ID",
        "Record type",
        "Dimension",
        "Item #",
        "Item",
        "Rater",
        "Rating",
        "Comment",
        "Fleiss' kappa",
        "Raw agreement (%)",
        "Disagreed items",
      ],
      [
        group.id,
        "Overall summary",
        "All dimensions",
        "",
        "",
        "",
        "",
        "",
        group.overall.fleissKappa ?? "",
        group.overall.percentAgreement ?? "",
        group.overall.disagreedItemCount ?? "",
      ],
    ];

    group.dimensions.forEach((dimension) => {
      rows.push([
        group.id,
        "Dimension summary",
        dimension.name,
        "",
        "",
        "",
        "",
        "",
        dimension.fleissKappa ?? "",
        dimension.percentAgreement ?? "",
        dimension.disagreedItemCount ?? "",
      ]);

      const dimensionRows = englishDataRows.filter(
        (row) => Number(row[0]?.match(/^\s*(\d{1,2})\./)?.[1]) === dimension.categoryNumber
      );
      dimensionRows.forEach((row) => {
        const itemCode = getItemCode(row[0], row[1]);
        group.raters.forEach((rater) => {
          rows.push([
            group.id,
            "Item rating",
            dimension.name,
            row[1],
            row[2],
            rater.rater,
            rater.itemRatings?.[itemCode] ?? "",
            rater.itemNotes?.[itemCode] ?? "",
            "",
            "",
            "",
          ]);
        });
      });
    });
    SUPPLEMENTAL_RATINGS.forEach((item) => {
      const key = `${item.type}:${item.code}`;
      group.raters.forEach((rater) => {
        rows.push([
          group.id,
          "Supplemental rating",
          item.label,
          "",
          "",
          rater.rater,
          rater.supplementalRatings?.[key]?.rating ?? "",
          rater.supplementalRatings?.[key]?.note ?? "",
          "",
          "",
          "",
        ]);
      });
    });
    downloadCsv(rows, `${group.id}_IRR.csv`);
  };

  const downloadSupplementalTemplate = () => {
    downloadCsv(
      [
        ["Rating type", "Code", "Dimension", "Rating", "Notes"],
        ...SUPPLEMENTAL_RATINGS.map((item) => [
          item.type,
          item.code,
          item.label,
          "",
          "",
        ]),
      ],
      "supplemental-ratings-template.csv"
    );
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

  const exportCompleteRatings = () => {
    if (!allItemsAnswered) {
      setSaveMessage("");
      setSaveError("Complete every binary rating item before exporting the CSV.");
      return;
    }

    const outRows = [
      [...englishHeaders, "Rating", "Notes"],
      ...englishDataRows.map((row, idx) => [
        ...row,
        ratings[idx]?.rating ?? "",
        ratings[idx]?.note ?? "",
      ]),
      [],
      ["Rating type", "Code", "Dimension", "Rating", "Notes"],
      ...SUPPLEMENTAL_RATINGS.map((item) => {
        const value = supplementalRatings[`${item.type}:${item.code}`] ?? {};
        return [
          item.type,
          item.code,
          item.label,
          value.rating ?? "",
          value.note ?? "",
        ];
      }),
    ];
    downloadCsv(outRows, `${videoId || "ratings"}_complete.csv`);
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
      supplementalRatings,
      autoMarkedRows: [...autoMarkedRows],
      answeredCount,
      totalItems: dataRows.length,
      answeredSupplementalCount,
      totalSupplementalRatings: SUPPLEMENTAL_RATINGS.length,
      completed: allItemsAnswered && allSupplementalRatingsAnswered,
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
        allItemsAnswered && allSupplementalRatingsAnswered
          ? "Completed ratings saved in this browser."
          : `Progress saved in this browser (${answeredCount} of ${dataRows.length} binary items and ${answeredSupplementalCount} of ${SUPPLEMENTAL_RATINGS.length} impression ratings answered).`
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
    setSupplementalRatings(savedRecord.supplementalRatings ?? {});
    setAutoMarkedRows(new Set(savedRecord.autoMarkedRows ?? []));
    setCurrentSavedId(savedRecord.id);
    setSaveError("");
    setSaveMessage("");
    setActiveTab("rating");
  };

  const startNewRating = () => {
    if (
      (Object.keys(ratings).length > 0 ||
        Object.keys(supplementalRatings).length > 0) &&
      !window.confirm("Clear the current ratings and start a new rating?")
    ) {
      return;
    }

    setRatings({});
    setSupplementalRatings({});
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
            Export binary ratings as CSV
          </button>
          <button
            type="button"
            onClick={exportCompleteRatings}
            disabled={!allItemsAnswered}
          >
            Export complete assessment CSV
          </button>
          <button type="button" onClick={startNewRating}>
            New rating
          </button>
        </div>
        <p className="small" role="status">
          {dataRows.length
            ? `${answeredCount} of ${dataRows.length} binary items and ${answeredSupplementalCount} of ${SUPPLEMENTAL_RATINGS.length} impression ratings answered. Both CSV exports require all binary items; the complete export includes the separate 11-score block.`
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
          <section
            aria-labelledby="supplemental-ratings-title"
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              border: "1px solid #e5d9f7",
              borderRadius: "8px",
              background: "#fbf8ff",
            }}
          >
            <h3 id="supplemental-ratings-title">
              {language === "JPN"
                ? "領域の印象評定・関係性総合評価"
                : "Domain Impression and Overall Relationship Ratings"}
            </h3>
            <p className="small">
              {language === "JPN"
                ? "各領域の全体的な印象を1〜5で評定し、関係性総合評価も別に評定してください。二値の項目得点とは分けて記録します。"
                : "Rate the overall impression of each domain and the relationship separately from the binary item scores. Use the 1–5 scale; these scores are not calculated from the binary ratings."}
            </p>
            <p className="small">
              {language === "JPN"
                ? "以前にダウンロードしたCSVに追加する場合は、下のテンプレートを開き、空行の後に全行を追加して評定欄に1〜5を入力してください。"
                : "To add these scores to an older downloaded CSV, download the template and append all of its rows after the 70 binary item rows; enter each score from 1 to 5."}
            </p>
            <button type="button" onClick={downloadSupplementalTemplate}>
              {language === "JPN"
                ? "5段階評定のCSVテンプレートをダウンロード"
                : "Download 5-point rating template"}
            </button>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>{language === "JPN" ? "評価項目" : "Rating"}</th>
                    <th>{language === "JPN" ? "評定値" : "Score"}</th>
                    <th>{language === "JPN" ? "コメント（任意）" : "Comment (optional)"}</th>
                  </tr>
                </thead>
                <tbody>
                  {SUPPLEMENTAL_RATINGS.map((item) => {
                    const key = `${item.type}:${item.code}`;
                    const value = supplementalRatings[key] ?? {};
                    return (
                      <tr key={key}>
                        <td>{language === "JPN" ? item.labelJpn : item.label}</td>
                        <td>
                          <select
                            aria-label={`${language === "JPN" ? item.labelJpn : item.label} ${
                              language === "JPN" ? "評定値" : "score"
                            }`}
                            value={value.rating ?? ""}
                            onChange={(event) =>
                              onSupplementalRatingChange(key, {
                                rating: event.target.value,
                              })
                            }
                          >
                            <option value="">
                              {language === "JPN" ? "選択" : "Select"}
                            </option>
                            {FIVE_POINT_SCALE.map((scale) => (
                              <option key={scale.value} value={scale.value}>
                                {scale.value} —{" "}
                                {language === "JPN" ? scale.labelJpn : scale.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <textarea
                            rows={1}
                            aria-label={`${language === "JPN" ? item.labelJpn : item.label} ${
                              language === "JPN" ? "コメント" : "comment"
                            }`}
                            value={value.note ?? ""}
                            onChange={(event) =>
                              onSupplementalRatingChange(key, {
                                note: event.target.value,
                              })
                            }
                            placeholder={
                              language === "JPN" ? "任意" : "Optional"
                            }
                            style={{ width: "100%" }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small" style={{ marginBottom: 0 }}>
              {language === "JPN"
                ? `評定済み: ${answeredSupplementalCount} / ${SUPPLEMENTAL_RATINGS.length}`
                : `Ratings completed: ${answeredSupplementalCount} / ${SUPPLEMENTAL_RATINGS.length}`}
            </p>
          </section>
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
                          {savedRecord.completed &&
                          (savedRecord.answeredSupplementalCount ?? 0) ===
                            SUPPLEMENTAL_RATINGS.length
                            ? "Completed"
                            : "In progress"} ·{" "}
                          {savedRecord.answeredCount} of {savedRecord.totalItems} items answered
                          {" · "}
                          {savedRecord.answeredSupplementalCount ?? 0} of{" "}
                          {savedRecord.totalSupplementalRatings ?? SUPPLEMENTAL_RATINGS.length} impression ratings
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
                Optional domain impression and overall relationship scores in the
                appended 1–5 CSV section are retained and displayed separately; they
                are not included in the binary-item reliability statistics.
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
                      <div
                        aria-label={`Overall agreement for video ${group.id}`}
                        style={{
                          margin: "1rem 0",
                          padding: "1rem",
                          border: "1px solid #e5d9f7",
                          borderRadius: "8px",
                          background: "#fbf8ff",
                        }}
                      >
                        <strong>Overall raw agreement</strong>
                        {group.overall.percentAgreement == null ? (
                          <p className="small" style={{ marginBottom: 0 }}>
                            Need at least two raters to calculate agreement.
                          </p>
                        ) : (
                          <>
                            <div
                              role="progressbar"
                              aria-label="Overall raw agreement"
                              aria-valuemin="0"
                              aria-valuemax="100"
                              aria-valuenow={group.overall.percentAgreement}
                              style={{
                                height: "1.25rem",
                                marginTop: "0.5rem",
                                overflow: "hidden",
                                borderRadius: "999px",
                                background: "#e9e2f1",
                              }}
                            >
                              <div
                                style={{
                                  width: `${group.overall.percentAgreement}%`,
                                  height: "100%",
                                  background: "#985bf9",
                                  transition: "width 0.2s ease",
                                }}
                              />
                            </div>
                            <p className="small" style={{ marginBottom: 0 }}>
                              {group.overall.percentAgreement.toFixed(1)}% agreement ·{" "}
                              {group.overall.disagreedItemCount} of {group.overall.itemCount} items
                              had at least one disagreement
                            </p>
                          </>
                        )}
                      </div>
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
                            {group.dimensions.map((dimension) => {
                              const dimensionKey = `${group.id}:${dimension.categoryNumber}`;
                              const isExpanded = Boolean(
                                expandedReliabilityDimensions[dimensionKey]
                              );
                              const dimensionRows = englishDataRows.filter(
                                (row) =>
                                  Number(row[0]?.match(/^\s*(\d{1,2})\./)?.[1]) ===
                                  dimension.categoryNumber
                              );
                              return (
                                <React.Fragment key={dimension.categoryNumber}>
                                  <tr>
                                    <td>
                                      <button
                                        type="button"
                                        class="collapsible"
                                        aria-expanded={isExpanded}
                                        onClick={() =>
                                          toggleReliabilityDimension(
                                            group.id,
                                            dimension.categoryNumber
                                          )
                                        }
                                      >
                                        {isExpanded ? "Hide item ratings" : "View item ratings"}
                                      </button>
                                      <div>{dimension.name}</div>
                                    </td>
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
                                  {isExpanded && (
                                    <tr>
                                      <td colSpan="4">
                                        <div style={{ overflowX: "auto" }}>
                                          <table>
                                            <thead>
                                              <tr>
                                                <th>Item #</th>
                                                <th>Item</th>
                                                {group.raters.map((rater) => (
                                                  <th key={rater.rater}>{rater.rater}</th>
                                                ))}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {dimensionRows.map((row) => {
                                                const itemCode = getItemCode(row[0], row[1]);
                                                return (
                                                  <tr key={itemCode}>
                                                    <td>{row[1]}</td>
                                                    <td>{row[2]}</td>
                                                    {group.raters.map((rater) => (
                                                      <td key={rater.rater}>
                                                        <strong>
                                                          {rater.itemRatings?.[itemCode] ?? "—"}
                                                        </strong>
                                                        {rater.itemNotes?.[itemCode] && (
                                                          <div className="small">
                                                            {rater.itemNotes[itemCode]}
                                                          </div>
                                                        )}
                                                      </td>
                                                    ))}
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <h4>Supplemental 1–5 ratings (reported separately)</h4>
                      <p className="small">
                        These impression scores are not included in Fleiss’ kappa or
                        raw agreement for the binary IRS items.
                      </p>
                      <div style={{ overflowX: "auto" }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Rating</th>
                              {group.raters.map((rater) => (
                                <th key={rater.rater}>{rater.rater}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {SUPPLEMENTAL_RATINGS.map((item) => {
                              const key = `${item.type}:${item.code}`;
                              return (
                                <tr key={key}>
                                  <td>{item.label}</td>
                                  {group.raters.map((rater) => {
                                    const value = rater.supplementalRatings?.[key];
                                    return (
                                      <td key={rater.rater}>
                                        {value?.rating || "—"}
                                        {value?.note && (
                                          <div className="small">{value.note}</div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <button
                        type="button"
                        onClick={() => exportReliabilityReport(group)}
                        style={{ marginTop: "0.75rem" }}
                      >
                        Download IRR CSV
                      </button>
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
