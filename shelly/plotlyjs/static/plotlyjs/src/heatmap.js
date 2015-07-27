'use strict';

// ---external global dependencies
/* global d3:false */

var heatmap = module.exports = {},
    Plotly = require('./plotly'),
    tinycolor = require('tinycolor2'),
    isNumeric = require('./isnumeric'),
    scatterAttrs = Plotly.Scatter.attributes;

Plotly.Plots.register(heatmap, 'heatmap', ['cartesian', '2dMap']);

var traceColorbarAttrs = Plotly.Colorbar.traceColorbarAttributes;

heatmap.attributes = {
    z: {type: 'data_array'},
    x: scatterAttrs.x,
    x0: scatterAttrs.x0,
    dx: scatterAttrs.dx,
    y: scatterAttrs.y,
    y0: scatterAttrs.y0,
    dy: scatterAttrs.dy,
    text: {type: 'data_array'},
    transpose: {
        type: 'boolean',
        dflt: false
    },
    xtype: {
        type: 'enumerated',
        values: ['array', 'scaled']
    },
    ytype: {
        type: 'enumerated',
        values: ['array', 'scaled']
    },
    zauto: traceColorbarAttrs.zauto,
    zmin: traceColorbarAttrs.zmin,
    zmax: traceColorbarAttrs.zmax,
    colorscale: traceColorbarAttrs.colorscale,
    autocolorscale: {
        type: 'boolean',
        dflt: false
    },
    reversescale: traceColorbarAttrs.reversescale,
    showscale: traceColorbarAttrs.showscale,
    zsmooth: {
        type: 'enumerated',
        values: ['fast', 'best', false],
        dflt: false
    },
    connectgaps: {
        type: 'boolean',
        dflt: false
    },
    _nestedModules: {  // nested module coupling
        'colorbar': 'Colorbar'
    },
    _composedModules: {  // composed module coupling
        'histogram2d': 'Histogram',
        'histogram2dcontour': 'Histogram'
    }
};

heatmap.supplyDefaults = function(traceIn, traceOut, defaultColor, layout) {
    function coerce(attr, dflt) {
        return Plotly.Lib.coerce(traceIn, traceOut, heatmap.attributes, attr, dflt);
    }

    function isValidZ(z) {
        var allRowsAreArrays = true,
            oneRowIsFilled = false,
            noNumbers = true;

        var zi;

        if (!(Array.isArray(z) && z.length)) return false;

        for (var i = 0; i < z.length; i++) {
            zi = z[i];
            if (!Array.isArray(zi)) allRowsAreArrays = false;
            if (!oneRowIsFilled && zi.length) oneRowIsFilled = true;
            for(var j = 0; j < zi.length; j++) {
            // Check that there is at least one numeric element...
                if(isNumeric(zi[j])) {
                    noNumbers = false;
                    break;
                }
            }
        }
        // ... otherwise set array as invalid:
        if(noNumbers) return false;

        return (allRowsAreArrays && oneRowIsFilled);
    }

    if(Plotly.Plots.traceIs(traceOut, 'histogram')) {
        // x, y, z, marker.color, and x0, dx, y0, dy are coerced
        // in Histogram.supplyDefaults
        // (along with histogram-specific attributes)
        Plotly.Histogram.supplyDefaults(traceIn, traceOut);
        if(traceOut.visible === false) return;
    }
    else {
        var z = coerce('z');
        if(!isValidZ(z)) {
            traceOut.visible = false;
            return;
        }

        coerce('transpose');

        var x = coerce('x'),
            xtype = x ? coerce('xtype', 'array') : 'scaled';
        if(xtype==='scaled') {
            coerce('x0');
            coerce('dx');
        }

        var y = coerce('y'),
            ytype = y ? coerce('ytype', 'array') : 'scaled';
        if(ytype==='scaled') {
            coerce('y0');
            coerce('dy');
        }

        coerce('connectgaps');
        coerce('text');
    }

    var isContour = Plotly.Plots.traceIs(traceOut, 'contour');

    if(!isContour || (traceOut.contours || {}).coloring!=='none') {
        Plotly.Colorscale.handleDefaults(
            traceIn, traceOut, layout, coerce, {prefix: '', cLetter: 'z'}
        );
    }

    if(!isContour) coerce('zsmooth');
};

heatmap.calc = function(gd, trace) {
    // prepare the raw data
    // run makeCalcdata on x and y even for heatmaps, in case of category mappings
    Plotly.Lib.markTime('start convert x&y');
    var xa = Plotly.Axes.getFromId(gd, trace.xaxis||'x'),
        ya = Plotly.Axes.getFromId(gd, trace.yaxis||'y'),
        isContour = Plotly.Plots.traceIs(trace, 'contour'),
        isHist = Plotly.Plots.traceIs(trace, 'histogram'),
        zsmooth = isContour ? 'best' : trace.zsmooth,
        x,
        x0,
        dx,
        y,
        y0,
        dy,
        z,
        i;

    // cancel minimum tick spacings (only applies to bars and boxes)
    xa._minDtick = 0;
    ya._minDtick = 0;

    Plotly.Lib.markTime('done convert x&y');

    if(isHist) {
        var binned = Plotly.Histogram.calc2d(gd, trace);
        x = binned.x;
        x0 = binned.x0;
        dx = binned.dx;
        y = binned.y;
        y0 = binned.y0;
        dy = binned.dy;
        z = binned.z;
    }
    else {
        x = trace.x ? xa.makeCalcdata(trace, 'x') : [];
        x0 = trace.x0||0;
        dx = trace.dx||1;

        y = trace.y ? ya.makeCalcdata(trace, 'y') : [];
        y0 = trace.y0||0;
        dy = trace.dy||1;

        if(trace.transpose) {
            var maxcols = Plotly.Lib.aggNums(Math.max,0,
                    trace.z.map(function(r){return r.length;}));
            z = [];
            for(var c = 0; c < maxcols; c++) {
                var newrow = [];
                for(var r = 0; r < trace.z.length; r++) {
                    newrow.push(cleanZ(trace.z[r][c]));
                }
                z.push(newrow);
            }
        }
        else z = trace.z.map(function(row){return row.map(cleanZ); });

        if(isContour || trace.connectgaps) {
            trace._emptypoints = findEmpties(z);
            trace._interpz = interp2d(z, trace._emptypoints, trace._interpz);
        }
    }

    function noZsmooth(msg) {
        zsmooth = trace._input.zsmooth = trace.zsmooth = false;
        Plotly.Lib.notifier('cannot fast-zsmooth: ' + msg);
    }

    // check whether we really can smooth (ie all boxes are about the same size)
    if(zsmooth === 'fast') {
        if(xa.type==='log' || ya.type==='log') {
            noZsmooth('log axis found');
        }
        else if(!isHist) {
            if(x.length) {
                var avgdx = (x[x.length-1]-x[0]) / (x.length-1),
                    maxErrX = Math.abs(avgdx/100);
                for(i=0; i<x.length-1; i++) {
                    if(Math.abs(x[i+1]-x[i]-avgdx)>maxErrX) {
                        noZsmooth('x scale is not linear');
                        break;
                    }
                }
            }
            if(y.length && zsmooth === 'fast') {
                var avgdy = (y[y.length-1]-y[0])/(y.length-1),
                maxErrY = Math.abs(avgdy/100);
                for(i=0; i<y.length-1; i++) {
                    if(Math.abs(y[i+1]-y[i]-avgdy)>maxErrY) {
                        noZsmooth('y scale is not linear');
                        break;
                    }
                }
            }
        }
    }

    // create arrays of brick boundaries, to be used by autorange and heatmap.plot
    var xlen = Plotly.Lib.aggNums(Math.max,null,
            z.map(function(row) { return row.length; })),
        xIn = trace.xtype==='scaled' ? '' : trace.x,
        xArray = makeBoundArray(trace, xIn, x0, dx, xlen, xa),
        yIn = trace.ytype==='scaled' ? '' : trace.y,
        yArray = makeBoundArray(trace, yIn, y0, dy, z.length, ya);
    Plotly.Axes.expand(xa, xArray);
    Plotly.Axes.expand(ya, yArray);

    var cd0 = {x: xArray, y: yArray, z: z};

    // auto-z and autocolorscale if applicable
    Plotly.Colorscale.calc(trace, z, '', 'z');

    if(isContour && trace.contours && trace.contours.coloring==='heatmap') {
        var hmType = trace.type === 'contour' ? 'heatmap' : 'histogram2d';
        cd0.xfill = makeBoundArray(hmType, xIn, x0, dx, xlen, xa);
        cd0.yfill = makeBoundArray(hmType, yIn, y0, dy, z.length, ya);
    }

    return [cd0];
};

function cleanZ(v) {
    if(!v && v!==0) return undefined;
    v = Number(v);
    if(isNaN(v)) return undefined;
    return v;
}

function makeBoundArray(trace, arrayIn, v0In, dvIn, numbricks, ax) {
    var arrayOut = [],
        isContour = Plotly.Plots.traceIs(trace, 'contour'),
        isHist = Plotly.Plots.traceIs(trace, 'histogram'),
        v0,
        dv,
        i;
    if(Array.isArray(arrayIn) && !isHist && (ax.type!=='category')) {
        arrayIn = arrayIn.map(ax.d2c);
        var len = arrayIn.length;

        // given vals are brick centers
        // hopefully length==numbricks, but use this method even if too few are supplied
        // and extend it linearly based on the last two points
        if(len <= numbricks) {
            // contour plots only want the centers
            if(isContour) arrayOut = arrayIn.slice(0,numbricks);
            else if(numbricks === 1) arrayOut = [arrayIn[0]-0.5,arrayIn[0]+0.5];
            else {
                arrayOut = [1.5*arrayIn[0]-0.5*arrayIn[1]];
                for(i=1; i<len; i++) {
                    arrayOut.push((arrayIn[i-1] + arrayIn[i])*0.5);
                }
                arrayOut.push(1.5*arrayIn[len-1] - 0.5*arrayIn[len-2]);
            }

            if(len < numbricks) {
                var lastPt = arrayOut[arrayOut.length - 1],
                    delta = lastPt - arrayOut[arrayOut.length - 2];
                for(i = len; i < numbricks; i++) {
                    lastPt += delta;
                    arrayOut.push(lastPt);
                }
            }
        }
        // hopefully length==numbricks+1, but do something regardless:
        // given vals are brick boundaries
        else return arrayIn.slice(0, numbricks+1);
    }
    else {
        dv = dvIn || 1;
        if(v0In===undefined) v0 = 0;
        else if(isHist || ax.type==='category') v0 = v0In;
        else v0 = ax.d2c(v0In);

        for(i = isContour ? 0 : -0.5; i < numbricks; i++) arrayOut.push(v0 + dv * i);
    }
    return arrayOut;
}

var INTERPTHRESHOLD = 1e-2,
    NEIGHBORSHIFTS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function correctionOvershoot(maxFractionalChange) {
    // start with less overshoot, until we know it's converging,
    // then ramp up the overshoot for faster convergence
    return 0.5 - 0.25 * Math.min(1, maxFractionalChange * 0.5);
}

function interp2d(z, emptyPoints, savedInterpZ) {
    // fill in any missing data in 2D array z using an iterative
    // poisson equation solver with zero-derivative BC at edges
    // amazingly, this just amounts to repeatedly averaging all the existing
    // nearest neighbors (at least if we don't take x/y scaling into account)
    var maxFractionalChange = 1,
        i,
        thisPt;

    if(Array.isArray(savedInterpZ)) {
        for(i = 0; i < emptyPoints.length; i++) {
            thisPt = emptyPoints[i];
            z[thisPt[0]][thisPt[1]] = savedInterpZ[thisPt[0]][thisPt[1]];
        }
    }
    else {
        // one pass to fill in a starting value for all the empties
        iterateInterp2d(z, emptyPoints);
    }

    // we're don't need to iterate lone empties - remove them
    for(i = 0; i < emptyPoints.length; i++) {
        if(emptyPoints[i][2] < 4) break;
    }
    // but don't remove these points from the original array,
    // we'll use them for masking, so make a copy.
    emptyPoints = emptyPoints.slice(i);

    for(i = 0; i < 100 && maxFractionalChange > INTERPTHRESHOLD; i++) {
        maxFractionalChange = iterateInterp2d(z, emptyPoints,
            correctionOvershoot(maxFractionalChange));
    }
    if(maxFractionalChange > INTERPTHRESHOLD) {
        console.log('interp2d didn\'t converge quickly', maxFractionalChange);
    }

    return z;
}

heatmap.maxRowLength = function(z) {
    var len = 0;
    for(var i = 0; i < z.length; i++) {
        len = Math.max(len, z[i].length);
    }
    return len;
};

function findEmpties(z) {
    // return a list of empty points in 2D array z
    // each empty point z[i][j] gives an array [i, j, neighborCount]
    // neighborCount is the count of 4 nearest neighbors that DO exist
    // this is to give us an order of points to evaluate for interpolation.
    // if no neighbors exist, we iteratively look for neighbors that HAVE
    // neighbors, and add a fractional neighborCount
    var empties = [],
        neighborHash = {},
        noNeighborList = [],
        nextRow = z[0],
        row = [],
        blank = [0, 0, 0],
        rowLength = heatmap.maxRowLength(z),
        prevRow,
        i,
        j,
        thisPt,
        p,
        neighborCount,
        newNeighborHash,
        foundNewNeighbors;

    for(i = 0; i < z.length; i++) {
        prevRow = row;
        row = nextRow;
        nextRow = z[i + 1] || [];
        for(j = 0; j < rowLength; j++) {
            if(row[j]===undefined) {
                neighborCount = (row[j - 1] !== undefined ? 1 : 0) +
                    (row[j + 1] !== undefined ? 1 : 0) +
                    (prevRow[j] !== undefined ? 1 : 0) +
                    (nextRow[j] !== undefined ? 1 : 0);

                if(neighborCount) {
                    // for this purpose, don't count off-the-edge points
                    // as undefined neighbors
                    if(i === 0) neighborCount++;
                    if(j === 0) neighborCount++;
                    if(i === z.length - 1) neighborCount++;
                    if(j === row.length - 1) neighborCount++;

                    // if all neighbors that could exist do, we don't
                    // need this for finding farther neighbors
                    if(neighborCount < 4) {
                        neighborHash[[i,j]] = [i, j, neighborCount];
                    }

                    empties.push([i, j, neighborCount]);
                }
                else noNeighborList.push([i, j]);
            }
        }
    }

    while(noNeighborList.length) {
        newNeighborHash = {};
        foundNewNeighbors = false;

        // look for cells that now have neighbors but didn't before
        for(p = noNeighborList.length - 1; p >= 0; p--) {
            thisPt = noNeighborList[p];
            i = thisPt[0];
            j = thisPt[1];

            neighborCount = ((neighborHash[[i - 1, j]] || blank)[2] +
                (neighborHash[[i + 1, j]] || blank)[2] +
                (neighborHash[[i, j - 1]] || blank)[2] +
                (neighborHash[[i, j + 1]] || blank)[2])/20;

            if(neighborCount) {
                newNeighborHash[thisPt] = [i, j, neighborCount];
                noNeighborList.splice(p, 1);
                foundNewNeighbors = true;
            }
        }

        if(!foundNewNeighbors) {
            throw 'findEmpties iterated with no new neighbors';
        }

        // put these new cells into the main neighbor list
        for(thisPt in newNeighborHash) {
            neighborHash[thisPt] = newNeighborHash[thisPt];
            empties.push(newNeighborHash[thisPt]);
        }
    }

    // sort the full list in descending order of neighbor count
    return empties.sort(function(a, b) { return b[2] - a[2]; });
}

function iterateInterp2d(z, emptyPoints, overshoot) {
    var maxFractionalChange = 0,
        thisPt,
        i,
        j,
        p,
        q,
        neighborShift,
        neighborRow,
        neighborVal,
        neighborCount,
        neighborSum,
        initialVal,
        minNeighbor,
        maxNeighbor;

    for(p = 0; p < emptyPoints.length; p++) {
        thisPt = emptyPoints[p];
        i = thisPt[0];
        j = thisPt[1];
        initialVal = z[i][j];
        neighborSum = 0;
        neighborCount = 0;

        for (q = 0; q < 4; q++) {
            neighborShift = NEIGHBORSHIFTS[q];
            neighborRow = z[i + neighborShift[0]];
            if(!neighborRow) continue;
            neighborVal = neighborRow[j + neighborShift[1]];
            if(neighborVal !== undefined) {
                if(neighborSum === 0) {
                    minNeighbor = maxNeighbor = neighborVal;
                }
                else {
                    minNeighbor = Math.min(minNeighbor, neighborVal);
                    maxNeighbor = Math.max(maxNeighbor, neighborVal);
                }
                neighborCount++;
                neighborSum += neighborVal;
            }
        }

        if(neighborCount === 0) {
            throw 'iterateInterp2d order is wrong: no defined neighbors';
        }

        // this is the laplace equation interpolation:
        // each point is just the average of its neighbors
        // note that this ignores differential x/y scaling
        // which I think is the right approach, since we
        // don't know what that scaling means
        z[i][j] = neighborSum / neighborCount;

        if(initialVal === undefined) {
            if(neighborCount < 4) maxFractionalChange = 1;
        }
        else {
            // we can make large empty regions converge faster
            // if we overshoot the change vs the previous value
            z[i][j] = (1 + overshoot) * z[i][j] - overshoot * initialVal;

            if(maxNeighbor > minNeighbor) {
                maxFractionalChange = Math.max(maxFractionalChange,
                    Math.abs(z[i][j] - initialVal) / (maxNeighbor - minNeighbor));
            }
        }
    }

    return maxFractionalChange;
}

// From http://www.xarg.org/2010/03/generate-client-side-png-files-using-javascript/
heatmap.plot = function(gd, plotinfo, cdheatmaps) {
    cdheatmaps.forEach(function(cd) { plotOne(gd, plotinfo, cd); });
};

function plotOne(gd, plotinfo, cd) {
    Plotly.Lib.markTime('in Heatmap.plot');
    var trace = cd[0].trace,
        uid = trace.uid,
        xa = plotinfo.x(),
        ya = plotinfo.y(),
        fullLayout = gd._fullLayout,
        id = 'hm' + uid,
        cbId = 'cb' + uid;

    fullLayout._paper.selectAll('.contour' + uid).remove(); // in case this used to be a contour map

    if(trace.visible !== true) {
        fullLayout._paper.selectAll('.' + id).remove();
        fullLayout._paper.selectAll('.' + cbId).remove();
        return;
    }

    var z = cd[0].z,
        min = trace.zmin,
        max = trace.zmax,
        scl = Plotly.Colorscale.getScale(trace.colorscale),
        x = cd[0].x,
        y = cd[0].y,
        isContour = Plotly.Plots.traceIs(trace, 'contour'),
        zsmooth = isContour ? 'best' : trace.zsmooth,

        // get z dims
        m = z.length,
        n = heatmap.maxRowLength(z),
        xrev = false,
        left,
        right,
        temp,
        yrev = false,
        top,
        bottom,
        i;

    // TODO: if there are multiple overlapping categorical heatmaps,
    // or if we allow category sorting, then the categories may not be
    // sequential... may need to reorder and/or expand z

    // Get edges of png in pixels (xa.c2p() maps axes coordinates to pixel coordinates)
    // figure out if either axis is reversed (y is usually reversed, in pixel coords)
    // also clip the image to maximum 50% outside the visible plot area
    // bigger image lets you pan more naturally, but slows performance.
    // TODO: use low-resolution images outside the visible plot for panning
    // these while loops find the first and last brick bounds that are defined
    // (in case of log of a negative)
    i = 0;
    while(left === undefined && i < x.length - 1) {
        left = xa.c2p(x[i]);
        i++;
    }
    i = x.length - 1;
    while(right === undefined && i > 0) {
        right = xa.c2p(x[i]);
        i--;
    }

    if(right < left) {
        temp = right;
        right = left;
        left = temp;
        xrev = true;
    }

    i = 0;
    while(top === undefined && i < y.length - 1) {
        top = ya.c2p(y[i]);
        i++;
    }
    i = y.length - 1;
    while(bottom === undefined && i > 0) {
        bottom = ya.c2p(y[i]);
        i--;
    }

    if(bottom < top) {
        temp = top;
        top = bottom;
        bottom = temp;
        yrev = true;
    }

    // for contours with heatmap fill, we generate the boundaries based on
    // brick centers but then use the brick edges for drawing the bricks
    if(isContour) {
        // TODO: for 'best' smoothing, we really should use the given brick
        // centers as well as brick bounds in calculating values, in case of
        // nonuniform brick sizes
        x = cd[0].xfill;
        y = cd[0].yfill;
    }

    // make an image that goes at most half a screen off either side, to keep
    // time reasonable when you zoom in. if zsmooth is true/fast, don't worry
    // about this, because zooming doesn't increase number of pixels
    // if zsmooth is best, don't include anything off screen because it takes too long
    if(zsmooth !== 'fast') {
        var extra = zsmooth === 'best' ? 0 : 0.5;
        left = Math.max(-extra * xa._length, left);
        right = Math.min((1 + extra) * xa._length, right);
        top = Math.max(-extra * ya._length, top);
        bottom = Math.min((1 + extra) * ya._length, bottom);
    }

    var imageWidth = Math.round(right - left),
        imageHeight = Math.round(bottom - top);

    // now redraw

    // if image is entirely off-screen, don't even draw it
    if(imageWidth <= 0 || imageHeight <= 0) return;

    var canvasW, canvasH;
    if(zsmooth === 'fast') {
        canvasW = n;
        canvasH = m;
    } else {
        canvasW = imageWidth;
        canvasH = imageHeight;
    }

    var canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    var context = canvas.getContext('2d');

    // interpolate for color scale
    // use an array instead of color strings, so we preserve alpha
    var s = d3.scale.linear()
        .domain(scl.map(function(si){ return si[0]; }))
        .range(scl.map(function(si){
            var c = tinycolor(si[1]).toRgb();
            return [c.r, c.g, c.b, c.a];
        }))
        .clamp(true);

    // map brick boundaries to image pixels
    var xpx,
        ypx;
    if(zsmooth === 'fast') {
        xpx = xrev ?
            function(index) { return n - 1 - index; } :
            Plotly.Lib.identity;
        ypx = yrev ?
            function(index) { return m - 1 - index; } :
            Plotly.Lib.identity;
    }
    else {
        xpx = function(index){
            return Plotly.Lib.constrain(Math.round(xa.c2p(x[index]) - left),
                0, imageWidth);
        };
        ypx = function(index){
            return Plotly.Lib.constrain(Math.round(ya.c2p(y[index]) - top),
                0, imageHeight);
        };
    }

    // get interpolated bin value. Returns {bin0:closest bin, frac:fractional dist to next, bin1:next bin}
    function findInterp(pixel, pixArray) {
        var maxbin = pixArray.length - 2,
            bin = Plotly.Lib.constrain(Plotly.Lib.findBin(pixel, pixArray), 0, maxbin),
            pix0 = pixArray[bin],
            pix1 = pixArray[bin + 1],
            interp = Plotly.Lib.constrain(bin + (pixel - pix0) / (pix1 - pix0) - 0.5, 0, maxbin),
            bin0 = Math.round(interp),
            frac = Math.abs(interp - bin0);

        if(!interp || interp === maxbin || !frac) {
            return {
                bin0: bin0,
                bin1: bin0,
                frac: 0
            };
        }
        return {
            bin0: bin0,
            frac: frac,
            bin1: Math.round(bin0 + frac / (interp - bin0))
        };
    }

    function setColor(v, pixsize) {
        if(v !== undefined) {
            var c = s((v - min) / (max - min));
            c[0] = Math.round(c[0]);
            c[1] = Math.round(c[1]);
            c[2] = Math.round(c[2]);

            pixcount += pixsize;
            rcount += c[0] * pixsize;
            gcount += c[1] * pixsize;
            bcount += c[2] * pixsize;
            return c;
        }
        return [0, 0, 0, 0];
    }

    function putColor(pixels, pxIndex, c) {
        pixels[pxIndex] = c[0];
        pixels[pxIndex + 1] = c[1];
        pixels[pxIndex + 2] = c[2];
        pixels[pxIndex + 3] = Math.round(c[3] * 255);
    }

    function interpColor(r0, r1, xinterp, yinterp) {
        var z00 = r0[xinterp.bin0];
        if(z00 === undefined) return setColor(undefined, 1);

        var z01 = r0[xinterp.bin1],
            z10 = r1[xinterp.bin0],
            z11 = r1[xinterp.bin1],
            dx = (z01 - z00) || 0,
            dy = (z10 - z00) || 0,
            dxy;

        // the bilinear interpolation term needs different calculations
        // for all the different permutations of missing data
        // among the neighbors of the main point, to ensure
        // continuity across brick boundaries.
        if(z01 === undefined) {
            if(z11 === undefined) dxy = 0;
            else if(z10 === undefined) dxy = 2 * (z11 - z00);
            else dxy = (2 * z11 - z10 - z00) * 2/3;
        }
        else if(z11 === undefined) {
            if(z10 === undefined) dxy = 0;
            else dxy = (2 * z00 - z01 - z10) * 2/3;
        }
        else if(z10 === undefined) dxy = (2 * z11 - z01 - z00) * 2/3;
        else dxy = (z11 + z00 - z01 - z10);

        return setColor(z00 + xinterp.frac * dx + yinterp.frac * (dy + xinterp.frac * dxy));
    }

    Plotly.Lib.markTime('done init png');
    // build the pixel map brick-by-brick
    // cruise through z-matrix row-by-row
    // build a brick at each z-matrix value
    var yi = ypx(0),
        yb = [yi, yi],
        xbi = xrev ? 0 : 1,
        ybi = yrev ? 0 : 1,
        // for collecting an average luminosity of the heatmap
        pixcount = 0,
        rcount = 0,
        gcount = 0,
        bcount = 0,
        xb,
        j,
        xi,
        v,
        row,
        c;

    if(zsmooth) { // best or fast, works fastest with imageData
        var pxIndex = 0,
            pixels = new Uint8Array(imageWidth * imageHeight * 4);

        if(zsmooth === 'best') {
            var xPixArray = new Array(x.length),
                yPixArray = new Array(y.length),
                xinterpArray = new Array(imageWidth),
                yinterp,
                r0,
                r1;

            // first make arrays of x and y pixel locations of brick boundaries
            for(i = 0; i < x.length; i++) xPixArray[i] = Math.round(xa.c2p(x[i]) - left);
            for(i = 0; i < y.length; i++) yPixArray[i] = Math.round(ya.c2p(y[i]) - top);

            // then make arrays of interpolations
            // (bin0=closest, bin1=next, frac=fractional dist.)
            for(i = 0; i < imageWidth; i++) xinterpArray[i] = findInterp(i, xPixArray);

            // now do the interpolations and fill the png
            for(j = 0; j < imageHeight; j++) {
                yinterp = findInterp(j, yPixArray);
                r0 = z[yinterp.bin0];
                r1 = z[yinterp.bin1];
                for(i = 0; i < imageWidth; i++, pxIndex += 4) {
                    c = interpColor(r0, r1, xinterpArray[i], yinterp);
                    putColor(pixels, pxIndex, c);
                }
            }
        }
        else { // zsmooth = fast
            for(j = 0; j < m; j++) {
                row = z[j];
                yb = ypx(j);
                for(i = 0; i < n; i++) {
                    c = setColor(row[i],1);
                    pxIndex = (yb * imageWidth + xpx(i)) * 4;
                    putColor(pixels, pxIndex, c);
                }
            }
        }

        var imageData = context.createImageData(imageWidth, imageHeight);
        imageData.data.set(pixels);
        context.putImageData(imageData, 0, 0);
    } else { // zsmooth = false -> filling potentially large bricks works fastest with fillRect
        for(j = 0; j < m; j++) {
            row = z[j];
            yb.reverse();
            yb[ybi] = ypx(j + 1);
            if(yb[0] === yb[1] || yb[0] === undefined || yb[1] === undefined) {
                continue;
            }
            xi = xpx(0);
            xb = [xi, xi];
            for(i = 0; i < n; i++) {
                // build one color brick!
                xb.reverse();
                xb[xbi] = xpx(i + 1);
                if(xb[0] === xb[1] || xb[0] === undefined || xb[1] === undefined) {
                    continue;
                }
                v = row[i];
                c = setColor(v, (xb[1] - xb[0]) * (yb[1] - yb[0]));
                context.fillStyle = 'rgba(' + c.join(',') + ')';
                context.fillRect(xb[0], yb[0], (xb[1] - xb[0]), (yb[1] - yb[0]));
            }
        }
    }

    Plotly.Lib.markTime('done filling png');

    rcount = Math.round(rcount / pixcount);
    gcount = Math.round(gcount/ pixcount);
    bcount = Math.round(bcount / pixcount);
    var avgColor = tinycolor('rgb(' + rcount + ',' + gcount + ',' + bcount + ')');

    gd._hmpixcount = (gd._hmpixcount||0) + pixcount;
    gd._hmlumcount = (gd._hmlumcount||0) + pixcount * avgColor.getLuminance();

    // put this right before making the new image, to minimize flicker
    fullLayout._paper.selectAll('.'+id).remove();
    plotinfo.plot.select('.maplayer').append('svg:image')
        .classed(id, true)
        .datum(cd[0])
        .attr({
            xmlns: 'http://www.w3.org/2000/svg',
            'xlink:xlink:href': canvas.toDataURL('image/png'), // odd d3 quirk, need namespace twice
            height: imageHeight,
            width: imageWidth,
            x: left,
            y: top,
            preserveAspectRatio: 'none'
        });

    Plotly.Lib.markTime('done showing png');
}

heatmap.colorbar = Plotly.Colorbar.traceColorbar;

heatmap.style = function(gd) {
    d3.select(gd).selectAll('image').style('opacity',function(d){ return d.trace.opacity; });
};

heatmap.hoverPoints = function(pointData, xval, yval, hovermode, contour) {
    // never let a heatmap override another type as closest point
    if(pointData.distance<Plotly.Fx.MAXDIST) return;

    var cd0 = pointData.cd[0],
        trace = cd0.trace,
        xa = pointData.xa,
        ya = pointData.ya,
        x = cd0.x,
        y = cd0.y,
        z = cd0.z,
        zmask = cd0.zmask,
        x2 = x,
        y2 = y,
        xl,
        yl,
        nx,
        ny;
    if(pointData.index!==false) {
        try {
            nx = Math.round(pointData.index[1]);
            ny = Math.round(pointData.index[0]);
        }
        catch(e) {
            console.log('Error hovering on heatmap, ' +
                'pointNumber must be [row,col], found:', pointData.index);
            return;
        }
        if(nx<0 || nx>=z[0].length || ny<0 || ny>z.length) {
            return;
        }
    }
    else if(Plotly.Fx.inbox(xval-x[0], xval-x[x.length-1])>Plotly.Fx.MAXDIST ||
            Plotly.Fx.inbox(yval-y[0], yval-y[y.length-1])>Plotly.Fx.MAXDIST) {
        return;
    }
    else {
        if(contour) {
            x2 = [2*x[0]-x[1]];
            for(var i2=1; i2<x.length; i2++) {
                x2.push((x[i2]+x[i2-1])/2);
            }
            x2.push([2*x[x.length-1]-x[x.length-2]]);

            y2 = [2*y[0]-y[1]];
            for(i2=1; i2<y.length; i2++) {
                y2.push((y[i2]+y[i2-1])/2);
            }
            y2.push([2*y[y.length-1]-y[y.length-2]]);
        }
        nx = Math.max(0,Math.min(x2.length-2,
            Plotly.Lib.findBin(xval,x2)));
        ny = Math.max(0,Math.min(y2.length-2,
            Plotly.Lib.findBin(yval,y2)));
    }
    var x0 = xa.c2p(x[nx]),
        x1 = xa.c2p(x[nx+1]),
        y0 = ya.c2p(y[ny]),
        y1 = ya.c2p(y[ny+1]);
    if(contour) {
        x1=x0;
        xl=x[nx];
        y1=y0;
        yl=y[ny];
    }
    else {
        xl = (x[nx]+x[nx+1])/2;
        yl = (y[ny]+y[ny+1])/2;
        if(trace.zsmooth) {
            x0=x1=(x0+x1)/2;
            y0=y1=(y0+y1)/2;
        }
    }

    var zVal = z[ny][nx];
    if(zmask && !zmask[ny][nx]) zVal = undefined;

    var text;
    if(Array.isArray(trace.text) && Array.isArray(trace.text[ny])) {
        text = trace.text[ny][nx];
    }

    return [$.extend(pointData,{
        index: [ny, nx],
        // never let a 2D override 1D type as closest point
        distance: Plotly.Fx.MAXDIST+10,
        x0: x0,
        x1: x1,
        y0: y0,
        y1: y1,
        xLabelVal: xl,
        yLabelVal: yl,
        zLabelVal: zVal,
        text: text
    })];
};
