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
  const [activeScoringHint, setActiveScoringHint] = useState(null);
  const [ratings, setRatings] = useState({});
  const [autoMarkedRows, setAutoMarkedRows] = useState(new Set()); // Track which rows are auto-marked
  const [savedRatings, setSavedRatings] = useState([]);
  const [currentSavedId, setCurrentSavedId] = useState(null);
  const [activeTab, setActiveTab] = useState("rating");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const used_csv = CSV_FILES[language];

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
                  const itemHint = scoringRules[itemCode]?.length
                    ? scoringRules[itemCode].join("\n")
                    : language === "JPN"
                      ? "IRS_scoring_rules_JPN.mdには、この項目に関する個別のルールや例は記載されていません。"
                      : "No item-specific rule or example for this item is listed in IRS_scoring_rules.md.";
                  
                  return (
                    <tr key={idx} style={rowStyle}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${idx}-${cellIndex}`}>
                          {cell}
                          {cellIndex === 2 && (
                            <button
                              type="button"
                              className="info-button"
                              aria-label={`Scoring information for item ${itemCode}`}
                              aria-describedby={
                                activeScoringHint?.itemCode === itemCode
                                  ? "scoring-hint-popup"
                                  : undefined
                              }
                              onMouseEnter={(event) =>
                                showScoringHint(event, itemCode, scoringRulesError || itemHint)
                              }
                              onMouseLeave={() => setActiveScoringHint(null)}
                              onFocus={(event) =>
                                showScoringHint(event, itemCode, scoringRulesError || itemHint)
                              }
                              onBlur={() => setActiveScoringHint(null)}
                              style={{ marginLeft: "0.5rem", cursor: "help" }}
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
            </>
          ) : (
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
