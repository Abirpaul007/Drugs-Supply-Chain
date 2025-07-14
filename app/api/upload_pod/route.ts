import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import dbConnect from '@/lib/db/mongodborder';
import Pod from '@/lib/models/pod';
import Order from '@/lib/models/orderh';


import VendorInventory from '@/lib/models/Vendor-Inventory';
import { User } from '@/lib/models/User';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const hospitalUserId = session?.user?._id;

    if (!hospitalUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const orderId = formData.get('orderId') as string;

    if (!file || !orderId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await dbConnect();

    // ✅ Check if POD already exists
    const existingPod = await Pod.findOne({ orderId });
    if (existingPod) {
      return NextResponse.json({ error: 'POD already uploaded for this order' }, { status: 409 });
    }

    // ✅ Find the order
    const order = await Order.findOne({ orderId });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const { medicineId, hospitalName } = order;

    

    // ✅ Find vendor via VendorInventory
    const inventory = await VendorInventory.findOne({ medicineId }).populate('userId');
    if (!inventory || !inventory.userId) {
      return NextResponse.json({ error: 'Vendor not found for this medicine' }, { status: 404 });
    }

    const vendorId = inventory.userId._id;

    // ✅ Upload file to Cloudinary
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', folder: 'pods', format: 'pdf' },
      async (error, result) => {
        if (error || !result) {
          console.error('Cloudinary upload error:', error);
          return NextResponse.json({ error: 'Cloudinary upload failed' }, { status: 500 });
        }

        try {
          const newPod = new Pod({
            orderId,
            hospitalName,
            hospitalUserId,
            vendorId,
            podUrl: result.secure_url,
          });

          await newPod.save();
          return NextResponse.json({ message: 'POD uploaded successfully' }, { status: 200 });
        } catch (saveErr) {
          console.error('Mongoose Save Error:', saveErr);
          return NextResponse.json({ error: 'Database save failed' }, { status: 500 });
        }
      }
    );

    Readable.from(buffer).pipe(stream);

    return new Promise((resolve) => {
      stream.on('end', () => {
        resolve(new Response('OK', { status: 200 }));
      });
    });
  } catch (err) {
    console.error('Upload Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
