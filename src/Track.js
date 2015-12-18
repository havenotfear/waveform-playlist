'use strict';

import _ from 'lodash';
import uuid from 'uuid';
import h from 'virtual-dom/h';

const FADEIN = "FadeIn";
const FADEOUT = "FadeOut";

export default class {

    constructor(config, playout, name="Untitled", start=undefined, end=undefined, cueIn=null, cueOut=null, fades={}, enabledStates={}) {
        let defaultStatesEnabled = {
            'cursor': true,
            'fadein': true,
            'fadeout': true,
            'select': true,
            'shift': true,
            'record': true
        };

        this.config = config;

        this.sampleRate = this.config.getSampleRate();
        this.name = name;

        //stored in seconds.
        this.startTime = start || 0;
        this.endTime = end || (this.startTime + playout.getDuration());

        this.gain = 1;

        //stored in seconds since webaudio api deals in seconds.
        this.cueIn = cueIn || 0;
        this.cueOut = cueOut || playout.getDuration();
        this.duration = this.cueOut - this.cueIn;

        this.fades = fades;

        this.enabledStates = _.assign(defaultStatesEnabled, enabledStates);

        this.playout = playout;
    }

    setPeaks(peaks) {
        this.peaks = peaks;
    }

    getPeakLength() {
        return this.peaks[0]['minPeaks'].length;
    }

    saveFade(type, shape, start, end) {
        let id = uuid.v4();
        
        this.fades[id] = {
            type: type,
            shape: shape,
            start: start,
            end: end
        };

        return id;
    }

    removeFade(id) {
        delete this.fades[id];
    }

    removeFadeType(type) {
        _.forOwn(this.fades, (fade, id) => {
            if (fade.type === type) {
                this.removeFade(id);
            }
        });
    }

    setState(state) {

    }

    isPlaying() {
        return this.playout.isPlaying();
    }

    setGainLevel(level) {
        this.gain = level;
        this.playout.setGainLevel(level);
    }

    setMasterGainLevel(level) {
        this.playout.setMasterGainLevel(gain);
    }

    /*
        startTime, endTime in seconds (float).
        segment is for a highlighted section in the UI.

        returns a Promise that will resolve when the AudioBufferSource
        is either stopped or plays out naturally.
    */
    schedulePlay(now, startTime, endTime, options) { 
        var start,
            duration,
            relPos,
            when = now,
            segment = (endTime) ? (endTime - startTime) : undefined,
            sourcePromise;

        //1) track has no content to play.
        //2) track does not play in this selection.
        if ((this.endTime <= startTime) || (segment && (startTime + segment) < this.startTime)) {
            //return a resolved promise since this track is technically "stopped".
            return Promise.resolve();
        }

        //track should have something to play if it gets here.

        //the track starts in the future or on the cursor position
        if (this.startTime >= startTime) {
            start = 0;
            when = when + this.startTime - startTime; //schedule additional delay for this audio node.

            if (endTime) {
                segment = segment - (this.startTime - startTime);
                duration = Math.min(segment, this.duration);
            }
            else {
                duration = this.duration;
            }
        }
        else {
            start = startTime - this.startTime;

            if (endTime) {
                duration = Math.min(segment, this.duration - start);
            }
            else {
                duration = this.duration - start;
            }
        }

        start = start + this.cueIn;
        relPos = startTime - this.startTime;

        sourcePromise = this.playout.setUpSource();

        //param relPos: cursor position in seconds relative to this track.
        //can be negative if the cursor is placed before the start of this track etc.
        _.forOwn(this.fades, (fade) => {
            let startTime;
            let duration;

            //only apply fade if it's ahead of the cursor.
            if (relPos < fade.end) {
                if (relPos <= fade.start) {
                    startTime = now + (fade.start - relPos);
                    duration = fade.end - fade.start;
                }
                else if (relPos > fade.start && relPos < fade.end) {
                    startTime = now - (relPos - fade.start);
                    duration = fade.end - fade.start;
                }

                switch (fade.type) {
                    case FADEIN:
                        this.playout.applyFadeIn(startTime, duration, fade.shape);
                        break;
                    case FADEOUT:
                        this.playout.applyFadeOut(startTime, duration, fade.shape);
                        break;
                    default:
                        throw new Error("Invalid fade type saved on track.");
                }
            }
        });

        this.playout.setGainLevel(this.gain);
        this.playout.setMasterGainLevel(options.masterGain);
        this.playout.play(when, start, duration);

        return sourcePromise;
    }

    scheduleStop(when=0) {
        this.playout.stop(when);
    }

    drawFrame(cc, x, minPeak, maxPeak) {
        let h2 = this.config.getWaveHeight() / 2;
        let min;
        let max;

        max = Math.abs(maxPeak * h2);
        min = Math.abs(minPeak * h2);

        //draw maxs
        cc.fillRect(x, 0, 1, h2-max);
        //draw mins
        cc.fillRect(x, h2+min, 1, h2-min);
    }

    /*
    * virtual-dom hook for drawing to the canvas element.
    */
    hook(canvas, propertyName, previousValue) {
        //node is already created.
        if (previousValue !== undefined) {
            return;
        }

        let i = 0;
        let len = this.getPeakLength();
        let channelNum = canvas.dataset.channel;
        let channel = this.peaks[channelNum];
        let cc = canvas.getContext('2d');
        let colors = this.config.getColorScheme();

        console.log(channel);


        cc.fillStyle = colors.waveOutlineColor;

        for (i, len; i < len; i++) {
            this.drawFrame(cc, i, channel.minPeaks[i], channel.maxPeaks[i]);
        }
    }

    render() {
        var height = this.config.getWaveHeight();

        return h("div.channel-wrapper.state-select", {attributes: {
            "style": `width: 1324px; margin-left: 200px; height: ${height}px;`
            }}, [
            h("div.controls", {attributes: {
                "style": `height: ${height}px; width: 200px; position: absolute; left: 0px; z-index: 1000;`
            }}, [
                h("header", [ this.name ]),
                h("div.btn-group", [
                    h("span.btn.btn-default.btn-xs.btn-mute", [ "Mute" ]),
                    h("span.btn.btn-default.btn-xs.btn-solo", [ "Solo" ])
                ]),
                h("label", [
                    h("input.volume-slider", {attributes: {
                        "type": "range",
                        "min": "0",
                        "max": "100",
                        "value": "100"
                    }})
                ])
            ]),

            h("div.waveform", {attributes: {
                "style": `height: ${height}px; width: 1324px; position: relative;`
            }}, [
                h("div.cursor", {attributes: {
                    "style": "position: absolute; box-sizing: content-box; margin: 0px; padding: 0px; top: 0px; left: 0px; bottom: 0px; z-index: 100;"
                }}),
                Object.keys(this.peaks).map((channelNum) => {
                    return h("div.channel.channel-${channelNum}", {attributes: {
                        "style": `width: 1324px; height: ${height}px; top: 0px; left: 0px; position: absolute; margin: 0px; padding: 0px; z-index: 1;`
                    }}, [
                        h("div.channel-progress", {attributes: {
                            "style": `position: absolute; width: 0px; height: ${height}px; z-index: 2;`
                        }}),
                        h("canvas", {attributes: {
                            "width": "1324",
                            "height": height,
                            "data-offset": "0",
                            "data-channel": channelNum,
                            "style": "float: left; position: relative; margin: 0px; padding: 0px; z-index: 3;"
                        },
                        "render-hook": this})
                    ]);
                })
            ])
        ]);
    }
}