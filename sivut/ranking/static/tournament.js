var RESULT_FAVORED = 1;
var RESULT_TIE = 0.5;
var RESULT_UNFAVORED = 0;
var RESULT_ABANDONED = null;
var URI_KEY = (typeof URI_KEY == "undefined") ? decodeURIComponent(location.search.substring(1).split("&")[0]) : URI_KEY;

function ratingToClass(rating) {
    if (rating > 1600) return "warning";
    else if (rating > 1300) return "info";
    else return "primary";
}
Vue.filter('ratingToClass', ratingToClass);


function competitorToClass(competitor) {
    if (competitor.paused) return "danger";
    else if (matchesCompletedLength(competitor) > 1) return ratingToClass(competitor.ranking.getRating());
    else return "primary";
}
Vue.filter('competitorToClass', competitorToClass);


Vue.filter('competitorToProgressBarClass', function(competitor) {
    var response = "progress-bar-" + competitorToClass(competitor);
    if (competitor.matched) response += " progress-bar-striped active";
    return response;
});


Vue.filter('finished', function(matches, finished) {
    return matches.filter(function(match, index) {
        return match.finished && finished || !match.finished && !finished;
    });
});

function matchesCompleted(competitor) {
    return competitor.matches.filter(function(match, index) {
        return match.finished && match.result !== RESULT_ABANDONED;
    });
}
function matchesCompletedLength(competitor) {
    return matchesCompleted(competitor).length;
}
Vue.filter('matchesCompletedLength', matchesCompletedLength);


Vue.filter('favoredOrder', function(matches) {
    return matches.sort(function(a, b) {
        return b.favored.ranking.getRating() - a.favored.ranking.getRating()
             + b.unfavored.ranking.getRating() - a.unfavored.ranking.getRating();
    });
});


Vue.filter('round', function(value, decimals) {
    if (!value) {
        value = 0;
    }
    if (!decimals) {
        decimals = 0;
    }
    value = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
    return value.toFixed(decimals);
});


var tournamentNames = Object.keys(EXAMPLES).map(function(name) { return name; });
for (var key in localStorage) {
    if (key && localStorage.hasOwnProperty(key) && tournamentNames.indexOf(key) === -1) {
        tournamentNames.push(key);
    }
}


var vue_data = {
    lang: locale,
    tournamentNames: tournamentNames,
    name: URI_KEY,
    banner: null,
    ranking: new glicko2.Glicko2(),
    competitors: [],
    matches: [],
    RESULT_FAVORED: RESULT_FAVORED,
    RESULT_TIE: RESULT_TIE,
    RESULT_UNFAVORED: RESULT_UNFAVORED,
    RESULT_ABANDONED: RESULT_ABANDONED
};


// Save and load
function objectToJSON(obj) {
    var replacerCache = [];
    return JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null && value.hasOwnProperty("__rating")) {
            return null;
        }
        if (typeof value === 'object' && value !== null) {
            if (replacerCache.indexOf(value) !== -1) {
                return "jsonid:"+replacerCache.indexOf(value);
            }
            value.jsonid = replacerCache.length;
            replacerCache.push(value);
        }
        return value;
    });
}
function jsonToObject(json) {
    var reviverCache = {};
    var parsed = JSON.parse(json, function(k, v) {
        if (v === null) {
            return v;
        }

        if (typeof v === "object" && v.initialRating !== undefined) {
            v.ranking = vue_data.ranking.makePlayer();
        }

        if (typeof v === "object" && v.jsonid !== undefined) {
            reviverCache[v.jsonid] = v;
            delete v.jsonid;
        } else if (typeof v === "string" && v.endsWith("Z") && Date.parse(v)) {
            return new Date(Date.parse(v));
        }
        return v;
    });
    if (parsed) {
        function revive(obj) {
            for (var k in obj) {
                v = obj[k];
                if (typeof v === "object") {
                    revive(v);
                } else if (typeof v === "string" && v.startsWith("jsonid:")) {
                    obj[k] = reviverCache[v.split(":")[1]];
                }
            }
        }
        revive(parsed);
        return parsed;
    }
}


function tournamentSave() {
    localStorage[URI_KEY] = objectToJSON({
        competitors: vue.competitors,
        matches: vue.matches,
        banner: vue.banner
    });
}
if (localStorage[URI_KEY]) {
    parsed = jsonToObject(localStorage[URI_KEY]);
    for (var k in parsed) {
        vue_data[k] = parsed[k];
    }
}


/* Using the initially provided ratings, follow https://github.com/mmai/glicko2js#when-to-update-rankings
 * and regenerate each player's new rating from the start with the results provided thus far. */
function regenerateRatings() {
    vue.ranking = new glicko2.Glicko2();
    vue.competitors.forEach(function(competitor, index) {
        competitor.ranking = vue.ranking.makePlayer(competitor.initialRating);
    });
    var matches = [];
    vue.matches.forEach(function(match, index) {
        if (match.finished && match.result !== RESULT_ABANDONED) {
            matches.push([
                match.favored.ranking,
                match.unfavored.ranking,
                match.result
            ]);
        }
    });
    vue.ranking.updateRatings(matches);
    tournamentSave();
}


function suitability(competitor, considering) {
    var rating_difference = Math.abs(competitor.ranking.getRating() - considering.ranking.getRating());
    var matches_played_together = competitor.matches.filter(function(match) {
        return match.favored === considering || match.unfavored === considering;
    }).length;
    return rating_difference * (matches_played_together + 1) + matches_played_together * 300;  // Still not 100% on the best combination of these two variables
}


function planMatches() {

    // Pair up available competitors
    var any_planned = false;
    var active = vue.competitors.filter(function(competitor) {
        return !competitor.paused;
    });
    while (true) {

        // Filter down on active candidates without pending matches
        var pairable = active.filter(function(competitor) {
            return competitor.matches.filter(function(match) {
                return match.finished === null;
            }).length === 0;
        });

        // If we don't have enough pairable candidates, stop
        if (pairable.length < 2) {
            break;
        }

        // If we only have two, just select them outright
        else if (pairable.length === 2) {
            considering = pairable[0];
            pairing = pairable[1];
        }

        // Otherwise filter viable to least matches, and select the one with the highest score
        else {
            var fewest_matches = Math.min.apply(
                null,
                pairable.map(function(competitor, index) {
                    return competitor.matches.length;
                })
            );
            var competitors_with_fewest_matches = pairable.filter(function(competitor) {
                return competitor.matches.length == fewest_matches
            });
            var considering = competitors_with_fewest_matches.sort(function(a, b) {
                return b.ranking.getRating() - a.ranking.getRating() + (Math.random() - 0.5) * 0.01 // Random for tie breakers
            })[0];

            // If there are only four or fewer active candidates, just use round-robin
            if (active.length <= 4) {
                var opponent_history = considering.matches.map(function(match) {
                    return (match.favored === considering) ? match.unfavored : match.favored;
                });
                var pairing = pairable.filter(function(competitor) {
                    return competitor !== considering
                }).sort(function(a, b) {
                    return opponent_history.lastIndexOf(a) - opponent_history.lastIndexOf(b)
                         + (Math.random() - 0.5) * 0.01; // Random for tie breakers
                })[0];
            }

            // Otherwise pair with the viable candidate with the closest rating
            else {
                var pairing = null;
                var pairing_suitability = null;
                pairable.filter(function(competitor) {
                    return competitor !== considering
                }).forEach(function(competitor) {
                    competitor_suitability = suitability(competitor, considering) + (Math.random() - 0.5) * 0.01;
                    if (pairing_suitability === null || competitor_suitability < pairing_suitability) {
                        pairing = competitor;
                        pairing_suitability = competitor_suitability;
                    }
                });
            }
        }

        // Now that we have a pair, create a match
        makeMatch(considering, pairing);
        any_planned = true;
    }

    if (any_planned) {
        tournamentSave();
    }
}


function makeMatch(a, b) {
    if (a !== b) {
        var a_is_greater = a.ranking.getRating() > b.ranking.getRating();
        var match = {
            favored: a_is_greater ? a : b,
            unfavored: a_is_greater ? b : a,
            start: new Date(),
            result: null,
            finished: null
        };
        match.favoredRating = match.favored.ranking.getRating();
        match.unfavoredRating = match.unfavored.ranking.getRating();
        a.matches.push(match);
        a.matched = true;
        b.matches.push(match);
        b.matched = true;
        vue.matches.push(match);
    }
}


var vue = new Vue({
    el: '#vue-app',
    data: vue_data,
    methods: {
        planMatches,
        matchResolve(match, result) {
            match.result = result;
            match.finished = new Date();
            match.favored.matched = match.favored.matches.filter(function(match) {
                return match.finished === null;
            }).length > 0;
            match.unfavored.matched = match.unfavored.matches.filter(function(match) {
                return match.finished === null;
            }).length > 0;
            regenerateRatings();
        },
        matchRevert(match) {
            if (confirm(vue.lang.matchesRevertPrompt)) {
                match.result = null;
                match.finished = null;
                regenerateRatings();
            }
        },
        matchAdd() {
            var name_left = $("#match-add-left").val();
            var name_right = $("#match-add-right").val();
            var considering = vue.competitors.filter(function(competitor) { return competitor.name == name_left; })[0];
            var pairing = vue.competitors.filter(function(competitor) { return competitor.name == name_right; })[0];
            makeMatch(considering, pairing);
            tournamentSave();
            $("#match-add").modal("hide");
        },
        matchDeleteAll() {
            vue.competitors.forEach(function(competitor, index) {
                competitor.matches = []
                competitor.matched = false;
            });
            vue.matches = [];
        },
        tournamentAdd() {
            var name = (prompt(vue.lang.tournamentTitlePrompt) || "").trim();
            if (name) {
                location.href = "/?" + encodeURIComponent(name);
            }
        },
        tournamentExport() {
            tournamentSave();
            saveAs(
                new Blob(
                    [localStorage[URI_KEY]],
                    {type: "application/json;charset=utf-8"}
                ),
                URI_KEY + " (" + (new Date()).toISOString().split(".")[0].replace(/[^0-9]/g, "-") + ").json"
            );
        },
        tournamentDelete() {
            if (confirm(vue.lang.tournamentDeleteConfirm)) {
                delete localStorage[URI_KEY];
                location.href = "/";
            }
        },
        bannerChange() {
            var url = (prompt(vue.lang.tournamentBannerPrompt) || "").trim();
            if (!url || url.startsWith("http://") || url.startsWith("https://")) {
                vue.banner = url;
                tournamentSave();
            } else {
                alert(vue.lang.tournamentBannerWhine);
            }
        },
        competitorAdd(name) {
            if (!name) {
                name = (prompt(vue.lang.competitorNamePrompt) || "").trim();
            }
            if (!name) {
            } else if (vue.competitors.filter(function(competitor) { return competitor.name == name; }).length !== 0) {
                alert(vue.lang.competitorNameWhine);
            } else {
                vue.competitors.push({
                    name: name,
                    initialRating: vue.ranking._default_rating,
                    ranking: vue.ranking.makePlayer(vue.ranking._default_rating, vue.ranking._default_rd, vue.ranking._default_vol),
                    matches: [],
                    matched: false,
                    paused: false
                });
                tournamentSave();
            }
        },
        competitorAddMultiple() {
            $("#competitor-add-multiple textarea").val().trim().split("\n").forEach(function(name, index) {
                if (name) {
                    vue.competitorAdd(name);
                }
            });
            $("#competitor-add-multiple").modal("hide");
        },
        competitorPause(competitor) {
            competitor.paused = !competitor.paused;
            tournamentSave();
        },
        competitorInitialRatingChange(competitor) {
            var initialRating = parseInt(prompt(vue.lang.competitorRatingPrompt, competitor.initialRating / 100) * 100) || competitor.initialRating;
            competitor.initialRating = Math.max(500, Math.min(2000, initialRating));
            regenerateRatings();
            tournamentSave();
        },
        competitorNameChange(competitor) {
            var name = (prompt(vue.lang.competitorNamePrompt) || "").trim();
            if (!name) {
            } else if (vue.competitors.filter(function(competitor) { return competitor.name == name; }).length !== 0) {
                alert(vue.lang.competitorNameWhine);
            } else {
                competitor.name = name;
                tournamentSave();
            }
        }
    }
});


// Plan matches immediately upon page load
regenerateRatings();


// If the tournament is named "Example Tournament", run the demo
if (EXAMPLES.hasOwnProperty(vue.name) && !vue.competitors.length) {
    vue.banner = "https://sortmatch.ca/static/banner.jpg";
    var competitors = EXAMPLES[vue.name];
    for(var name in competitors) {
        var initialRating = competitors[name];
        vue.competitors.push({
            name: name,
            initialRating: initialRating,
            ranking: vue.ranking.makePlayer(initialRating, vue.ranking._default_rd, vue.ranking._default_vol),
            matches: [],
            matched: false,
            paused: false
        });
    }
    setTimeout(planMatches, 1300);
}


// Start the page focused on the competitor add button
$("#competitor-add").focus();


// Prevent "#" links from changing the url hash
$(document).on("click", "a[href='#']", function(event) {
    event.preventDefault();
});


// Handle file uploads
function handleFileSelect(evt) {
    var files = evt.target.files;
    for (var i=0, f; f=files[i]; i++) {
        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
                var name = (prompt("Under what name should "+theFile.name+" be saved?", theFile.name.split(" (2")[0]) || "").trim();
                if (name) {
                    localStorage[name] = e.target.result;
                    if (vue.tournamentNames.indexOf(name) === -1) {
                        vue.tournamentNames.push(name);
                    }
                }
            };
        })(f);

        // Read in the image file as a data URL.
        reader.readAsText(f);
    }
}
$("#files").on("change", handleFileSelect);


// Highlight other instances of this competitor's name when hovering
$(document).on("mouseenter mouseleave", "[data-competitor]", function(x) {
    var competitors_table = $("#competitors");
    competitors_table.find("td").css("background", "");
    $(".hover").removeClass("hover");
    if (x.type === "mouseenter") {
        var index = $(this).data("competitor");
        var competitor = vue.competitors[index];
        var opponent_counts = [];
        matchesCompleted(competitor).forEach(function(match) {
            var opponent = match.favored === competitor ? match.unfavored : match.favored;
            var opponent_index = vue.competitors.indexOf(opponent);
            if (opponent_counts[opponent_index] === undefined) {
                opponent_counts[opponent_index] = [0, 0];
            }
            if (match.result === RESULT_TIE) {
                opponent_counts[opponent_index][0] += 1;
                opponent_counts[opponent_index][1] += 1;
            } else if (match.result === RESULT_FAVORED && match.favored === competitor || match.result === RESULT_UNFAVORED && match.unfavored === competitor) {
                opponent_counts[opponent_index][0] += 1;
            } else {
                opponent_counts[opponent_index][1] += 1;
            }
        });
        opponent_counts.forEach(function(counts, opponent_index) {
            competitors_table.find("[data-competitor="+opponent_index+"]").closest("tr").find("td").css("background", "hsl("+parseInt(100 * counts[0] / (counts[0] + counts[1]))+", 56%, 89%)");
        });
        $("[data-competitor="+index+"]").closest("td, .label").addClass("hover").parent().addClass("hover");
    }
});


$("body").addClass(URI_KEY ? "detail" : "index");


function alphaTest() {
    vue.matches.filter(function(match) {
        return !match.finished;
    }).forEach(function(match) {
        match.finished = new Date();
        match.result = (match.favored.name < match.unfavored.name) ? RESULT_FAVORED : RESULT_UNFAVORED;
    });
    vue.competitors.forEach(function(competitor) {
        competitor.matched = competitor.matches.filter(function(match) {
            return match.finished === null;
        }).length > 0;
    });
    regenerateRatings();
    planMatches();
}
