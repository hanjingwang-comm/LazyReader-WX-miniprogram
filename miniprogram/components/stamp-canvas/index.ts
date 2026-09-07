const COLORS = ["#315d96", "#356750", "#a77a18"];

function cropCell(iconId: number, imageSize: number) {
  const cell = imageSize / 3;
  return { sx: (iconId % 3) * cell, sy: Math.floor(iconId / 3) * cell, size: cell };
}

Component({
  properties: {
    title: { type: String, value: "" },
    date: { type: String, value: "" },
    iconId: { type: Number, value: 0 }
  },
  observers: {
    "title,date,iconId": function (this: any) {
      if (this._ready) this.draw();
    }
  },
  lifetimes: {
    ready(this: any) {
      this._ready = true;
      this.draw();
    }
  },
  methods: {
    draw(this: any) {
      wx.createSelectorQuery().in(this).select("#stamp").fields({ node: true, size: true }).exec((result: any[]) => {
        const info = result?.[0];
        if (!info?.node || !info.width) return;
        const canvas = info.node;
        const ctx = canvas.getContext("2d");
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
        canvas.width = info.width * dpr;
        canvas.height = info.height * dpr;
        ctx.scale(dpr, dpr);
        const size = Math.min(info.width, info.height);
        const center = size / 2;
        const iconId = Math.max(0, Math.min(8, Number(this.data.iconId) || 0));
        const color = COLORS[iconId % COLORS.length];
        ctx.clearRect(0, 0, info.width, info.height);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = "round";
        ctx.globalAlpha = .92;
        ctx.lineWidth = Math.max(2, size * .018);
        ctx.beginPath();
        ctx.arc(center, center, size * .455, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = .62;
        ctx.lineWidth = Math.max(1, size * .008);
        ctx.beginPath();
        ctx.arc(center, center, size * .405, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = .78;
        for (let index = 0; index < 22; index += 1) {
          const angle = ((iconId * 17 + index * 47) % 360) * Math.PI / 180;
          const radius = size * (.405 + ((index * 13) % 8) / 1000);
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          ctx.fillRect(x, y, index % 3 === 0 ? 2 : 1, 1);
        }

        const image = canvas.createImage();
        image.onload = () => {
          const crop = cropCell(iconId, image.width);
          const drawSize = size * .55;
          ctx.globalAlpha = 1;
          ctx.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, center - drawSize / 2, center - drawSize / 2 + size * .02, drawSize, drawSize);
          this.drawText(ctx, size, center, color);
        };
        image.onerror = () => this.drawText(ctx, size, center, color);
        image.src = "/assets/book-stamp-icons.webp";
      });
    },

    drawText(this: any, ctx: any, size: number, center: number, color: string) {
      const rawTitle = String(this.data.title || "已读完").trim();
      const title = rawTitle.length > 14 ? `${rawTitle.slice(0, 13)}…` : rawTitle;
      const date = String(this.data.date || "").replace(/-/g, ".");
      ctx.fillStyle = color;
      ctx.globalAlpha = .96;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(10, size * .062)}px Courier New, monospace`;
      ctx.fillText(title, center, size * .15, size * .72);
      ctx.font = `700 ${Math.max(9, size * .054)}px Courier New, monospace`;
      ctx.fillText(date, center, size * .855, size * .62);
      ctx.globalAlpha = 1;
    }
  }
});
